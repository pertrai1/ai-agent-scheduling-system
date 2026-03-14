import { CronExpressionParser } from "cron-parser";
import type sqlite3 from "sqlite3";
import type { StoredAgent, StoredExecution } from "./agentRepository";
import { listAgents, listExecutionsByAgentId } from "./agentRepository";

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

export interface AgentMetrics {
  agentId: number;
  agentName: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  /** Value between 0 and 1. NaN when totalRuns === 0. */
  successRate: number;
  /** Average execution duration in milliseconds across runs that have durationMs set.
   *  undefined when no runs with durationMs exist. */
  avgDurationMs: number | undefined;
}

/**
 * Computes aggregate execution metrics for a single agent from its execution history.
 */
export function calculateAgentMetrics(
  agentId: number,
  agentName: string,
  executions: StoredExecution[]
): AgentMetrics {
  const totalRuns = executions.length;
  const successCount = executions.filter((e) => e.status === "success").length;
  const failureCount = totalRuns - successCount;
  const successRate = totalRuns > 0 ? successCount / totalRuns : NaN;

  const durations = executions
    .map((e) => e.durationMs)
    .filter((d): d is number => d !== undefined);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : undefined;

  return {
    agentId,
    agentName,
    totalRuns,
    successCount,
    failureCount,
    successRate,
    avgDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Unhealthy detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the agent's last 3 (or more) consecutive executions —
 * ordered from most-recent to oldest — all have status "failure".
 */
export function isAgentUnhealthy(executions: StoredExecution[]): boolean {
  if (executions.length < 3) return false;

  // executions may arrive in any order; sort descending by ranAt
  const sorted = [...executions].sort(
    (a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime()
  );

  return sorted.slice(0, 3).every((e) => e.status === "failure");
}

// ---------------------------------------------------------------------------
// Upcoming runs
// ---------------------------------------------------------------------------

export interface UpcomingRun {
  agentId: number;
  agentName: string;
  nextRunAt: string;
}

/**
 * Returns the next scheduled run time for each enabled agent that has a valid
 * cron expression, sorted by ascending `nextRunAt`.
 *
 * @param agents  List of stored agents to consider.
 * @param now     Reference time (defaults to `new Date()`).
 * @param limit   Maximum number of entries to return (defaults to 10).
 */
export function getUpcomingRuns(
  agents: StoredAgent[],
  now: Date = new Date(),
  limit = 10
): UpcomingRun[] {
  const upcoming: UpcomingRun[] = [];

  for (const agent of agents) {
    if (!agent.enabled || !agent.cronExpression) continue;
    try {
      const interval = CronExpressionParser.parse(agent.cronExpression, {
        currentDate: now,
      });
      const next = interval.next().toDate();
      upcoming.push({
        agentId: agent.id,
        agentName: agent.name,
        nextRunAt: next.toISOString(),
      });
    } catch {
      // skip agents with invalid cron expressions
    }
  }

  upcoming.sort(
    (a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime()
  );

  return upcoming.slice(0, limit);
}

// ---------------------------------------------------------------------------
// System status
// ---------------------------------------------------------------------------

export interface SystemStatus {
  registeredAgents: number;
  enabledAgents: number;
  upcomingRuns: UpcomingRun[];
  agentMetrics: AgentMetrics[];
  unhealthyAgents: Array<{ agentId: number; agentName: string }>;
}

/**
 * Computes a full system status snapshot from the database.
 */
export async function getSystemStatus(
  db: sqlite3.Database,
  now: Date = new Date()
): Promise<SystemStatus> {
  const agents = await listAgents(db);

  const registeredAgents = agents.length;
  const enabledAgents = agents.filter((a) => a.enabled).length;
  const upcomingRuns = getUpcomingRuns(agents, now);

  const metricsAndHealth = await Promise.all(
    agents.map(async (agent) => {
      const executions = await listExecutionsByAgentId(db, agent.id);
      const metrics = calculateAgentMetrics(agent.id, agent.name, executions);
      const unhealthy = isAgentUnhealthy(executions);
      return { metrics, unhealthy, agent };
    })
  );

  const agentMetrics = metricsAndHealth.map((r) => r.metrics);
  const unhealthyAgents = metricsAndHealth
    .filter((r) => r.unhealthy)
    .map((r) => ({ agentId: r.agent.id, agentName: r.agent.name }));

  return { registeredAgents, enabledAgents, upcomingRuns, agentMetrics, unhealthyAgents };
}
