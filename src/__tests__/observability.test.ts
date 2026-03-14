import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { insertAgent, insertExecution } from "../agentRepository";
import { ApiServer } from "../apiServer";
import {
  calculateAgentMetrics,
  isAgentUnhealthy,
  getUpcomingRuns,
  getSystemStatus,
} from "../observability";
import { truncate } from "../logger";
import type sqlite3 from "sqlite3";
import type { StoredExecution } from "../agentRepository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

function makeExecution(
  overrides: Partial<StoredExecution> & { id: number; agentId: number }
): StoredExecution {
  return {
    agentName: "Test Agent",
    ranAt: new Date().toISOString(),
    status: "success",
    ...overrides,
  };
}

async function startTestServer(
  db: sqlite3.Database
): Promise<{ server: ApiServer; port: number }> {
  const server = new ApiServer(db);
  const port = await server.start(0);
  return { server, port };
}

async function apiGet(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`);
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

async function apiPost(
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = res.status === 204 ? null : await res.json();
  return { status: res.status, body: responseBody };
}

// ---------------------------------------------------------------------------
// truncate helper
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns the original string when it is within the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends ellipsis when the string exceeds the limit", () => {
    const result = truncate("hello world", 5);
    expect(result).toBe("hello…");
    expect(result.length).toBe(6); // 5 chars + ellipsis char
  });

  it("returns the original string when length equals the limit exactly", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("uses the default limit of 500", () => {
    const long = "x".repeat(600);
    const result = truncate(long);
    expect(result.length).toBe(501); // 500 + "…"
    expect(result.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateAgentMetrics
// ---------------------------------------------------------------------------

describe("calculateAgentMetrics", () => {
  it("returns zero counts and NaN success rate for an empty history", () => {
    const metrics = calculateAgentMetrics(1, "Agent", []);
    expect(metrics.totalRuns).toBe(0);
    expect(metrics.successCount).toBe(0);
    expect(metrics.failureCount).toBe(0);
    expect(Number.isNaN(metrics.successRate)).toBe(true);
    expect(metrics.avgDurationMs).toBeUndefined();
  });

  it("computes success rate correctly", () => {
    const executions: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, status: "success" }),
      makeExecution({ id: 2, agentId: 1, status: "success" }),
      makeExecution({ id: 3, agentId: 1, status: "failure" }),
    ];
    const metrics = calculateAgentMetrics(1, "Agent", executions);
    expect(metrics.totalRuns).toBe(3);
    expect(metrics.successCount).toBe(2);
    expect(metrics.failureCount).toBe(1);
    expect(metrics.successRate).toBeCloseTo(2 / 3);
  });

  it("computes average duration from runs that have durationMs", () => {
    const executions: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, durationMs: 100 }),
      makeExecution({ id: 2, agentId: 1, durationMs: 300 }),
    ];
    const metrics = calculateAgentMetrics(1, "Agent", executions);
    expect(metrics.avgDurationMs).toBe(200);
  });

  it("returns undefined avgDurationMs when no runs have durationMs", () => {
    const executions: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1 }),
    ];
    const metrics = calculateAgentMetrics(1, "Agent", executions);
    expect(metrics.avgDurationMs).toBeUndefined();
  });

  it("metrics update correctly after additional runs are included", () => {
    const first: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, status: "success", durationMs: 100 }),
    ];
    const second: StoredExecution[] = [
      ...first,
      makeExecution({ id: 2, agentId: 1, status: "failure", durationMs: 200 }),
    ];
    const m1 = calculateAgentMetrics(1, "Agent", first);
    const m2 = calculateAgentMetrics(1, "Agent", second);

    expect(m1.successRate).toBe(1);
    expect(m1.avgDurationMs).toBe(100);

    expect(m2.successRate).toBeCloseTo(0.5);
    expect(m2.avgDurationMs).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// isAgentUnhealthy
// ---------------------------------------------------------------------------

describe("isAgentUnhealthy", () => {
  it("returns false when there are fewer than 3 executions", () => {
    const execs: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, status: "failure" }),
      makeExecution({ id: 2, agentId: 1, status: "failure" }),
    ];
    expect(isAgentUnhealthy(execs)).toBe(false);
  });

  it("returns false when the last 3 are not all failures", () => {
    const now = new Date();
    const execs: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, status: "failure", ranAt: new Date(now.getTime() - 3000).toISOString() }),
      makeExecution({ id: 2, agentId: 1, status: "success", ranAt: new Date(now.getTime() - 2000).toISOString() }),
      makeExecution({ id: 3, agentId: 1, status: "failure", ranAt: new Date(now.getTime() - 1000).toISOString() }),
    ];
    expect(isAgentUnhealthy(execs)).toBe(false);
  });

  it("returns true when the last 3 consecutive executions are failures", () => {
    const now = new Date();
    const execs: StoredExecution[] = [
      makeExecution({ id: 1, agentId: 1, status: "success", ranAt: new Date(now.getTime() - 4000).toISOString() }),
      makeExecution({ id: 2, agentId: 1, status: "failure", ranAt: new Date(now.getTime() - 3000).toISOString() }),
      makeExecution({ id: 3, agentId: 1, status: "failure", ranAt: new Date(now.getTime() - 2000).toISOString() }),
      makeExecution({ id: 4, agentId: 1, status: "failure", ranAt: new Date(now.getTime() - 1000).toISOString() }),
    ];
    expect(isAgentUnhealthy(execs)).toBe(true);
  });

  it("returns false for an empty execution history", () => {
    expect(isAgentUnhealthy([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getUpcomingRuns
// ---------------------------------------------------------------------------

describe("getUpcomingRuns", () => {
  it("returns upcoming runs sorted by nextRunAt", () => {
    const now = new Date("2026-01-01T07:00:00.000Z");
    const agents = [
      {
        id: 1,
        name: "Hourly Agent",
        taskDescription: "T",
        enabled: true,
        cronExpression: "0 * * * *",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      {
        id: 2,
        name: "Daily Agent",
        taskDescription: "T",
        enabled: true,
        cronExpression: "0 8 * * *",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];

    const runs = getUpcomingRuns(agents, now);
    expect(runs.length).toBe(2);
    // Hourly (next :00 = 08:00) should come before daily (08:00 same time or after)
    expect(new Date(runs[0].nextRunAt).getTime()).toBeLessThanOrEqual(
      new Date(runs[1].nextRunAt).getTime()
    );
  });

  it("excludes disabled agents", () => {
    const now = new Date("2026-01-01T07:00:00.000Z");
    const agents = [
      {
        id: 1,
        name: "Disabled",
        taskDescription: "T",
        enabled: false,
        cronExpression: "* * * * *",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const runs = getUpcomingRuns(agents, now);
    expect(runs).toHaveLength(0);
  });

  it("excludes agents without a cron expression", () => {
    const now = new Date("2026-01-01T07:00:00.000Z");
    const agents = [
      {
        id: 1,
        name: "No Cron",
        taskDescription: "T",
        enabled: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const runs = getUpcomingRuns(agents, now);
    expect(runs).toHaveLength(0);
  });

  it("respects the limit parameter", () => {
    const now = new Date("2026-01-01T07:00:00.000Z");
    const agents = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${i + 1}`,
      taskDescription: "T",
      enabled: true,
      cronExpression: "* * * * *",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }));
    const runs = getUpcomingRuns(agents, now, 3);
    expect(runs).toHaveLength(3);
  });

  it("upcoming run times are accurate for '0 9 * * *' starting at 07:00", () => {
    const now = new Date("2026-01-01T07:00:00.000Z");
    const agents = [
      {
        id: 1,
        name: "9am Daily",
        taskDescription: "T",
        enabled: true,
        cronExpression: "0 9 * * *",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ];
    const runs = getUpcomingRuns(agents, now);
    expect(runs).toHaveLength(1);
    const next = new Date(runs[0].nextRunAt);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rolling execution history cap (last 100)
// ---------------------------------------------------------------------------

describe("Rolling execution history cap", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await openTestDb();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it("keeps only the 100 most recent executions per agent", async () => {
    const { listExecutionsByAgentId } = await import("../agentRepository");

    const agent = await insertAgent(db, {
      name: "Capped Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: true,
    });

    // Insert 105 executions
    for (let i = 0; i < 105; i++) {
      await insertExecution(db, agent.id, {
        agentName: agent.name,
        ranAt: new Date(Date.now() + i * 1000),
        status: "success",
        response: `run ${i}`,
        durationMs: 100,
      });
    }

    const executions = await listExecutionsByAgentId(db, agent.id);
    expect(executions.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// GET /status endpoint
// ---------------------------------------------------------------------------

describe("GET /status", () => {
  let db: sqlite3.Database;
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    db = await openTestDb();
    ({ server, port } = await startTestServer(db));
  });
  afterEach(async () => {
    await server.stop();
    await closeDatabase(db);
  });

  it("returns status with zero registered/enabled agents when empty", async () => {
    const { status, body } = await apiGet(port, "/status");
    expect(status).toBe(200);
    const s = body as Record<string, unknown>;
    expect(s.registeredAgents).toBe(0);
    expect(s.enabledAgents).toBe(0);
    expect(s.upcomingRuns).toEqual([]);
    expect(s.agentMetrics).toEqual([]);
    expect(s.unhealthyAgents).toEqual([]);
  });

  it("reflects registered and enabled agent counts", async () => {
    await apiPost(port, "/agents", {
      name: "Enabled Agent",
      taskDescription: "Task",
      scheduleInput: "* * * * *",
      enabled: true,
    });
    await apiPost(port, "/agents", {
      name: "Disabled Agent",
      taskDescription: "Task",
      enabled: false,
    });

    const { status, body } = await apiGet(port, "/status");
    expect(status).toBe(200);
    const s = body as Record<string, unknown>;
    expect(s.registeredAgents).toBe(2);
    expect(s.enabledAgents).toBe(1);
  });

  it("includes upcoming runs for enabled agents with cron expressions", async () => {
    await apiPost(port, "/agents", {
      name: "Scheduled Agent",
      taskDescription: "Task",
      scheduleInput: "0 9 * * *",
      enabled: true,
    });

    const { body } = await apiGet(port, "/status");
    const s = body as Record<string, unknown>;
    const upcoming = s.upcomingRuns as unknown[];
    expect(upcoming.length).toBeGreaterThan(0);
    const run = upcoming[0] as Record<string, unknown>;
    expect(run.agentName).toBe("Scheduled Agent");
    expect(typeof run.nextRunAt).toBe("string");
  });

  it("marks agent as unhealthy after 3 consecutive failures", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Unhealthy Agent",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const agentId = agent.id as number;

    // Insert 3 consecutive failures
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      await insertExecution(db, agentId, {
        agentName: "Unhealthy Agent",
        ranAt: new Date(now.getTime() + i * 1000),
        status: "failure",
        error: "Something went wrong",
      });
    }

    const { body } = await apiGet(port, "/status");
    const s = body as Record<string, unknown>;
    const unhealthy = s.unhealthyAgents as Array<Record<string, unknown>>;
    expect(unhealthy.length).toBe(1);
    expect(unhealthy[0].agentName).toBe("Unhealthy Agent");
  });

  it("does not mark agent unhealthy with only 2 consecutive failures", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Almost Unhealthy",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const agentId = agent.id as number;

    await insertExecution(db, agentId, {
      agentName: "Almost Unhealthy",
      ranAt: new Date(),
      status: "failure",
      error: "fail",
    });
    await insertExecution(db, agentId, {
      agentName: "Almost Unhealthy",
      ranAt: new Date(Date.now() + 1000),
      status: "failure",
      error: "fail again",
    });

    const { body } = await apiGet(port, "/status");
    const s = body as Record<string, unknown>;
    const unhealthy = s.unhealthyAgents as Array<Record<string, unknown>>;
    expect(unhealthy.length).toBe(0);
  });

  it("metrics in status update after multiple runs", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Metrics Agent",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const agentId = agent.id as number;

    await insertExecution(db, agentId, {
      agentName: "Metrics Agent",
      ranAt: new Date(),
      status: "success",
      durationMs: 100,
    });
    await insertExecution(db, agentId, {
      agentName: "Metrics Agent",
      ranAt: new Date(Date.now() + 1000),
      status: "failure",
      durationMs: 200,
    });

    const { body } = await apiGet(port, "/status");
    const s = body as Record<string, unknown>;
    const metrics = s.agentMetrics as Array<Record<string, unknown>>;
    const m = metrics.find((x) => x.agentName === "Metrics Agent");
    expect(m).toBeDefined();
    expect(m!.totalRuns).toBe(2);
    expect(m!.successCount).toBe(1);
    expect(m!.failureCount).toBe(1);
    expect(m!.avgDurationMs).toBe(150);
  });
});
