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

  /**
   * @param db     SQLite database connection.
   * @param client Gemini LLM client.
   * @param config Application config used for email notifications.
   *               When omitted, email notifications are silently disabled
   *               (useful in tests or environments without SMTP).
   */
  constructor(db: sqlite3.Database, client: GeminiClient, config?: Config) {
    this.db = db;
    this.client = client;
    this.config = config;
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
   * Evaluate all enabled agents and run any that are due, concurrently.
   * One agent's failure does not prevent others from running.
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

    const due = agents.filter((a) => a.enabled && isAgentDueNow(a, now));

    if (due.length === 0) return;

    structuredLog("info", "scheduler", "Tick: agents due", {
      tickAt: now.toISOString(),
      agentCount: due.length,
    });

    await Promise.allSettled(due.map((agent) => this.runAndRecord(agent)));
  }

  private async runAndRecord(storedAgent: StoredAgent): Promise<void> {
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

      await updateAgent(this.db, storedAgent.id, {
        lastRunAt: result.ranAt.toISOString(),
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
