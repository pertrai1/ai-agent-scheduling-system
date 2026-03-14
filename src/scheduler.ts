import type sqlite3 from "sqlite3";
import { CronExpressionParser } from "cron-parser";
import type { StoredAgent } from "./agentRepository";
import {
  listAgents,
  updateAgent,
  insertExecution,
} from "./agentRepository";
import { runAgent } from "./runAgent";
import type { GeminiClient } from "./geminiClient";
import type { Config } from "./config";
import { sendSuccess, sendFailure } from "./emailNotifier";
import { structuredLog, logExecutionStart, logExecutionEnd } from "./logger";

// ---------------------------------------------------------------------------
// Concurrency limiter (simple semaphore)
// ---------------------------------------------------------------------------

/**
 * A simple counting semaphore that limits the number of concurrent async
 * operations.  Callers `acquire()` a slot before starting work and
 * `release()` when done.
 */
export class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.running < this.maxConcurrent) {
        this.running++;
        resolve();
      } else {
        this.queue.push(() => {
          this.running++;
          resolve();
        });
      }
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Convenience wrapper: acquires the semaphore, runs `fn`, then releases.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Default maximum number of concurrent LLM calls. */
const DEFAULT_MAX_CONCURRENT_LLM = 5;

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * Returns the ISO-8601 string for the minute boundary containing `now`
 * (i.e. `now` with seconds and milliseconds set to zero).
 * Used as the schedule-window key for idempotency checks.
 */
export function getMinuteBoundary(now: Date): string {
  const floored = new Date(now);
  floored.setSeconds(0, 0);
  return floored.toISOString();
}

/**
 * Returns true when the agent already ran within the minute window that
 * contains `now`, based on its persisted `lastRunAt` timestamp.
 * This prevents duplicate executions if the process restarts mid-minute.
 */
export function hasRunInCurrentWindow(agent: StoredAgent, now: Date): boolean {
  if (!agent.lastRunAt) return false;
  return agent.lastRunAt.startsWith(getMinuteBoundary(now).slice(0, 16));
}

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the given stored agent is due to run at the minute
 * containing `now`.  The check is performed by flooring `now` to the
 * current minute boundary and comparing it against the next cron tick
 * that would fire after the millisecond immediately before that boundary.
 */
export function isAgentDueNow(agent: StoredAgent, now: Date): boolean {
  if (!agent.cronExpression) return false;

  const floored = new Date(now);
  floored.setSeconds(0, 0);

  try {
    const interval = CronExpressionParser.parse(agent.cronExpression, {
      currentDate: new Date(floored.getTime() - 1),
    });
    const next = interval.next().toDate();
    next.setSeconds(0, 0);
    return next.getTime() === floored.getTime();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 60_000; // 1 minute

export class Scheduler {
  private db: sqlite3.Database;
  private client: GeminiClient;
  private config: Config | undefined;
  private tickTimer: NodeJS.Timeout | null = null;
  private alignTimer: NodeJS.Timeout | null = null;
  /** Tracks in-flight run promises so graceful shutdown can await them. */
  private inFlight: Set<Promise<void>> = new Set();
  /** Limits concurrent LLM calls. */
  private semaphore: Semaphore;

  /**
   * @param db             SQLite database connection.
   * @param client         Gemini LLM client.
   * @param config         Application config used for email notifications.
   *                       When omitted, email notifications are silently disabled
   *                       (useful in tests or environments without SMTP).
   * @param maxConcurrent  Maximum number of concurrent LLM calls (default 5).
   */
  constructor(
    db: sqlite3.Database,
    client: GeminiClient,
    config?: Config,
    maxConcurrent = DEFAULT_MAX_CONCURRENT_LLM
  ) {
    this.db = db;
    this.client = client;
    this.config = config;
    this.semaphore = new Semaphore(maxConcurrent);
  }

  /**
   * Start the scheduler, aligning the first tick to the next whole-minute
   * boundary so that cron expressions are evaluated at the correct time.
   */
  start(): void {
    const now = new Date();
    const msUntilNextMinute =
      TICK_INTERVAL_MS - (now.getSeconds() * 1000 + now.getMilliseconds());

    this.alignTimer = setTimeout(() => {
      this.alignTimer = null;
      void this.tick();
      this.tickTimer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, msUntilNextMinute);

    structuredLog("info", "scheduler", "Started", {
      firstTickInMs: Math.round(msUntilNextMinute),
    });
  }

  /** Stop the scheduler and cancel any pending timers. */
  stop(): void {
    if (this.alignTimer !== null) {
      clearTimeout(this.alignTimer);
      this.alignTimer = null;
    }
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    structuredLog("info", "scheduler", "Stopped");
  }

  /**
   * Wait for all currently in-flight agent runs to complete.
   * Call this after `stop()` for a graceful shutdown.
   */
  async drain(): Promise<void> {
    if (this.inFlight.size > 0) {
      structuredLog("info", "scheduler", "Draining in-flight jobs", {
        count: this.inFlight.size,
      });
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /**
   * Evaluate all enabled agents and run any that are due, concurrently.
   * One agent's failure does not prevent others from running.
   * Idempotency: agents already run in the current minute window are skipped.
   */
  async tick(now: Date = new Date()): Promise<void> {
    let agents: StoredAgent[];
    try {
      agents = await listAgents(this.db);
    } catch (err: unknown) {
      structuredLog("error", "scheduler", "Failed to load agents", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const due = agents.filter((a) => {
      if (!a.enabled) return false;
      if (!isAgentDueNow(a, now)) return false;
      // Idempotency guard: skip if already ran in this minute window
      if (hasRunInCurrentWindow(a, now)) {
        structuredLog("info", "scheduler", "Skipping agent (already ran this window)", {
          agentName: a.name,
          window: getMinuteBoundary(now),
        });
        return false;
      }
      return true;
    });

    if (due.length === 0) return;

    structuredLog("info", "scheduler", "Tick: agents due", {
      tickAt: now.toISOString(),
      agentCount: due.length,
    });

    await Promise.allSettled(due.map((agent) => this.scheduleRun(agent, now)));
  }

  /**
   * Wraps `runAndRecord` in the concurrency semaphore and tracks the
   * promise in `inFlight` so that `drain()` can await it.
   */
  private scheduleRun(storedAgent: StoredAgent, tickNow: Date): Promise<void> {
    const promise = this.semaphore.run(() => this.runAndRecord(storedAgent, tickNow));
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
    return promise;
  }

  private async runAndRecord(storedAgent: StoredAgent, tickNow: Date): Promise<void> {
    const agentDef = {
      name: storedAgent.name,
      taskDescription: storedAgent.taskDescription,
      systemPrompt: storedAgent.systemPrompt,
      cronExpression: storedAgent.cronExpression,
      enabled: storedAgent.enabled,
      timeoutMs: storedAgent.timeoutMs,
      maxRetries: storedAgent.maxRetries,
      backoffBaseMs: storedAgent.backoffBaseMs,
      emailRecipient: storedAgent.emailRecipient,
    };

    const startTime = new Date();
    logExecutionStart("scheduler", storedAgent.name, startTime);

    try {
      const result = await runAgent(agentDef, this.client);

      // `lastRunAt` stores the scheduled tick time (the minute boundary that
      // triggered this run), not the wall-clock completion time.  This lets
      // the idempotency guard (`hasRunInCurrentWindow`) detect that the agent
      // already ran in this schedule window if the process restarts mid-minute.
      // The actual execution timestamp and duration are captured in the
      // `executions` table via `insertExecution` below.
      await updateAgent(this.db, storedAgent.id, {
        lastRunAt: tickNow.toISOString(),
      });
      await insertExecution(this.db, storedAgent.id, result);

      logExecutionEnd(
        "scheduler",
        storedAgent.name,
        startTime,
        result.status,
        result.attempts ?? 1,
        result.status === "success" ? result.response : result.error
      );

      if (this.config) {
        const notifyFn = result.status === "success" ? sendSuccess : sendFailure;
        await notifyFn(this.config, agentDef, result);
      }
    } catch (err: unknown) {
      structuredLog("error", "scheduler", "Unexpected error running agent", {
        agentName: storedAgent.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
