import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { insertAgent, updateAgent, listExecutionsByAgentId } from "../agentRepository";
import { isAgentDueNow, Scheduler, sleep, DEFAULT_STAGGER_MS } from "../scheduler";
import type { StoredAgent } from "../agentRepository";
import type { GeminiClient } from "../geminiClient";
import type sqlite3 from "sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

function makeStoredAgent(overrides: Partial<StoredAgent> = {}): StoredAgent {
  return {
    id: 1,
    name: "Test Agent",
    taskDescription: "Do something",
    enabled: true,
    cronExpression: "* * * * *",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockClient(response = "ok"): GeminiClient {
  return {
    generateText: vi.fn().mockResolvedValue(response),
  } as unknown as GeminiClient;
}

// ---------------------------------------------------------------------------
// isAgentDueNow
// ---------------------------------------------------------------------------

describe("isAgentDueNow", () => {
  it("returns true for '* * * * *' at any whole minute", () => {
    const agent = makeStoredAgent({ cronExpression: "* * * * *" });
    const now = new Date("2026-01-01T10:01:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(true);
  });

  it("returns true for '* * * * *' at the exact minute boundary", () => {
    const agent = makeStoredAgent({ cronExpression: "* * * * *" });
    // Even with seconds/ms present on `now`, it should floor to the minute
    const now = new Date("2026-01-01T10:01:30.500Z");
    expect(isAgentDueNow(agent, now)).toBe(true);
  });

  it("returns true for '*/5 * * * *' at a matching minute (10:05)", () => {
    const agent = makeStoredAgent({ cronExpression: "*/5 * * * *" });
    const now = new Date("2026-01-01T10:05:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(true);
  });

  it("returns false for '*/5 * * * *' at a non-matching minute (10:03)", () => {
    const agent = makeStoredAgent({ cronExpression: "*/5 * * * *" });
    const now = new Date("2026-01-01T10:03:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(false);
  });

  it("returns true for '0 7 * * *' at 07:00", () => {
    const agent = makeStoredAgent({ cronExpression: "0 7 * * *" });
    const now = new Date("2026-01-01T07:00:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(true);
  });

  it("returns false for '0 7 * * *' at 07:01", () => {
    const agent = makeStoredAgent({ cronExpression: "0 7 * * *" });
    const now = new Date("2026-01-01T07:01:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(false);
  });

  it("returns false when cronExpression is missing", () => {
    const agent = makeStoredAgent({ cronExpression: undefined });
    const now = new Date("2026-01-01T10:00:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(false);
  });

  it("returns false when cronExpression is invalid", () => {
    const agent = makeStoredAgent({ cronExpression: "not-a-cron" });
    const now = new Date("2026-01-01T10:00:00.000Z");
    expect(isAgentDueNow(agent, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheduler – concurrent execution and isolation
// ---------------------------------------------------------------------------

describe("Scheduler.tick", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await openTestDb();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it("executes an agent with '* * * * *' on every tick", async () => {
    const client = makeMockClient("response");
    await insertAgent(db, {
      name: "Every Minute",
      taskDescription: "Run every minute",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    const agents = await import("../agentRepository").then((m) =>
      m.fetchAgentByName(db, "Every Minute")
    );
    expect(agents?.lastRunAt).toBeDefined();
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });

  it("executes two agents scheduled for the same minute concurrently", async () => {
    const client = makeMockClient("response");
    await insertAgent(db, {
      name: "Agent Alpha",
      taskDescription: "Task A",
      cronExpression: "* * * * *",
      enabled: true,
    });
    await insertAgent(db, {
      name: "Agent Beta",
      taskDescription: "Task B",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    expect(client.generateText).toHaveBeenCalledTimes(2);
  });

  it("does not execute a disabled agent", async () => {
    const client = makeMockClient("response");
    await insertAgent(db, {
      name: "Disabled Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: false,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    expect(client.generateText).not.toHaveBeenCalled();
  });

  it("resumes execution when a previously disabled agent is re-enabled", async () => {
    const client = makeMockClient("response");
    const stored = await insertAgent(db, {
      name: "Toggle Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: false,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");

    // First tick – agent is disabled
    await scheduler.tick(now);
    expect(client.generateText).not.toHaveBeenCalled();

    // Re-enable the agent
    await updateAgent(db, stored.id, { enabled: true });

    // Second tick – agent should now run
    const now2 = new Date("2026-01-01T10:02:00.000Z");
    await scheduler.tick(now2);
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });

  it("one failing agent does not prevent other agents from running", async () => {
    const failClient: GeminiClient = {
      generateText: vi
        .fn()
        .mockRejectedValueOnce(new Error("LLM error"))
        .mockResolvedValueOnce("ok"),
    } as unknown as GeminiClient;

    await insertAgent(db, {
      name: "Failing Agent",
      taskDescription: "This will fail",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
    });
    await insertAgent(db, {
      name: "Succeeding Agent",
      taskDescription: "This will succeed",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
    });

    const scheduler = new Scheduler(db, failClient);
    const now = new Date("2026-01-01T10:01:00.000Z");

    // Should not throw even though one agent fails
    await expect(scheduler.tick(now)).resolves.toBeUndefined();
    expect(failClient.generateText).toHaveBeenCalledTimes(2);
  });

  it("records last-run timestamp after each execution", async () => {
    const client = makeMockClient("response");
    const stored = await insertAgent(db, {
      name: "Tracked Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    const updated = await import("../agentRepository").then((m) =>
      m.fetchAgentById(db, stored.id)
    );
    expect(updated?.lastRunAt).toBeDefined();
    expect(typeof updated?.lastRunAt).toBe("string");
  });

  it("persists an execution record after each agent run", async () => {
    const client = makeMockClient("summary output");
    const stored = await insertAgent(db, {
      name: "Recorded Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    const executions = await listExecutionsByAgentId(db, stored.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// Scheduler – rate-limit-aware staggering
// ---------------------------------------------------------------------------

describe("Scheduler staggering", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await openTestDb();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it("sleep() resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it("DEFAULT_STAGGER_MS is a positive number", () => {
    expect(typeof DEFAULT_STAGGER_MS).toBe("number");
    expect(DEFAULT_STAGGER_MS).toBeGreaterThan(0);
  });

  it("runs all agents even with staggerMs > 0 (all calls still happen)", async () => {
    const client = makeMockClient("response");
    await insertAgent(db, {
      name: "Stagger Alpha",
      taskDescription: "Task A",
      cronExpression: "* * * * *",
      enabled: true,
    });
    await insertAgent(db, {
      name: "Stagger Beta",
      taskDescription: "Task B",
      cronExpression: "* * * * *",
      enabled: true,
    });
    await insertAgent(db, {
      name: "Stagger Gamma",
      taskDescription: "Task C",
      cronExpression: "* * * * *",
      enabled: true,
    });

    // Use a small stagger (20 ms) so the test runs quickly
    const scheduler = new Scheduler(db, client, undefined, 5, undefined, 20);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    // All three agents must have been called despite the stagger
    expect(client.generateText).toHaveBeenCalledTimes(3);
  });

  it("staggerMs=0 disables staggering and all agents still run", async () => {
    const client = makeMockClient("response");
    await insertAgent(db, {
      name: "No-Stagger Alpha",
      taskDescription: "Task A",
      cronExpression: "* * * * *",
      enabled: true,
    });
    await insertAgent(db, {
      name: "No-Stagger Beta",
      taskDescription: "Task B",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client, undefined, 5, undefined, 0);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    expect(client.generateText).toHaveBeenCalledTimes(2);
  });

  it("stagger delays successive launches by approximately staggerMs per agent", async () => {
    const launchTimes: number[] = [];
    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async () => {
        launchTimes.push(Date.now());
        return "ok";
      }),
    } as unknown as GeminiClient;

    await insertAgent(db, {
      name: "Time Agent 1",
      taskDescription: "Task 1",
      cronExpression: "* * * * *",
      enabled: true,
    });
    await insertAgent(db, {
      name: "Time Agent 2",
      taskDescription: "Task 2",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const staggerMs = 50;
    const scheduler = new Scheduler(db, client, undefined, 5, undefined, staggerMs);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    expect(launchTimes).toHaveLength(2);
    // Second agent should start at least staggerMs ms after the first
    const gap = launchTimes[1] - launchTimes[0];
    expect(gap).toBeGreaterThanOrEqual(staggerMs - 10); // allow 10 ms tolerance
  });
});

// ---------------------------------------------------------------------------
// validateCronExpression
// ---------------------------------------------------------------------------

describe("validateCronExpression", () => {
  it("accepts standard five-field expressions", async () => {
    const { validateCronExpression } = await import("../cronValidator");
    expect(validateCronExpression("* * * * *")).toBe(true);
    expect(validateCronExpression("0 7 * * *")).toBe(true);
    expect(validateCronExpression("*/5 * * * *")).toBe(true);
    expect(validateCronExpression("0 9 * * 1-5")).toBe(true);
  });

  it("rejects invalid expressions", async () => {
    const { validateCronExpression } = await import("../cronValidator");
    expect(validateCronExpression("not-a-cron")).toBe(false);
    expect(validateCronExpression("")).toBe(false);
    expect(validateCronExpression("99 99 99 99 99")).toBe(false);
  });
});
