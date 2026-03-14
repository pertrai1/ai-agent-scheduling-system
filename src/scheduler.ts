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
  private tickTimer: NodeJS.Timeout | null = null;
  private alignTimer: NodeJS.Timeout | null = null;

  constructor(db: sqlite3.Database, client: GeminiClient) {
    this.db = db;
    this.client = client;
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

    console.log(
      `[scheduler] Started. First tick in ${Math.round(msUntilNextMinute / 1000)}s.`
    );
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
    console.log("[scheduler] Stopped.");
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
      console.error("[scheduler] Failed to load agents:", err);
      return;
    }

    const due = agents.filter((a) => a.enabled && isAgentDueNow(a, now));

    if (due.length === 0) return;

    console.log(`[scheduler] Tick at ${now.toISOString()}: ${due.length} agent(s) due.`);

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
    };

    try {
      const result = await runAgent(agentDef, this.client);

      await updateAgent(this.db, storedAgent.id, {
        lastRunAt: result.ranAt.toISOString(),
      });
      await insertExecution(this.db, storedAgent.id, result);

      console.log(
        `[scheduler] Agent "${storedAgent.name}" finished with status: ${result.status}`
      );
    } catch (err: unknown) {
      console.error(
        `[scheduler] Unexpected error running agent "${storedAgent.name}":`,
        err
      );
    }
  }
}
