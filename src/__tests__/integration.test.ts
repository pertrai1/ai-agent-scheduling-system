/**
 * Integration tests — Phase 9
 *
 * These tests cover an end-to-end scheduled run scenario:
 * agent is created, the scheduler tick fires, execution is persisted, and the
 * status endpoint reflects the result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import {
  insertAgent,
  fetchAgentById,
  listExecutionsByAgentId,
} from "../agentRepository";
import { Scheduler, Semaphore, getMinuteBoundary, hasRunInCurrentWindow } from "../scheduler";
import { ApiServer } from "../apiServer";
import type sqlite3 from "sqlite3";
import type { GeminiClient } from "../geminiClient";
import type { StoredAgent } from "../agentRepository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

function makeMockClient(response = "llm output"): GeminiClient {
  return {
    generateText: vi.fn().mockResolvedValue(response),
  } as unknown as GeminiClient;
}

function makeStoredAgent(overrides: Partial<StoredAgent> = {}): StoredAgent {
  return {
    id: 1,
    name: "Test Agent",
    taskDescription: "Do something",
    enabled: true,
    cronExpression: "* * * * *",
    systemPrompt: undefined,
    emailRecipient: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    backoffBaseMs: undefined,
    lastRunAt: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// End-to-end scheduled run
// ---------------------------------------------------------------------------

describe("Integration: end-to-end scheduled run", () => {
  let db: sqlite3.Database;
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    db = await openTestDb();
    server = new ApiServer(db);
    port = await server.start(0);
  });

  afterEach(async () => {
    await server.stop();
    await closeDatabase(db);
  });

  it("creates an agent, runs a scheduler tick, and records the execution", async () => {
    const client = makeMockClient("daily briefing output");

    // Create an enabled agent with a every-minute schedule.
    const stored = await insertAgent(db, {
      name: "Briefing Agent",
      taskDescription: "Provide a morning briefing",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-06-01T09:01:00.000Z");
    await scheduler.tick(now);

    // LLM was called once.
    expect(client.generateText).toHaveBeenCalledTimes(1);

    // lastRunAt is updated on the agent.
    const updated = await fetchAgentById(db, stored.id);
    expect(updated?.lastRunAt).toBeDefined();

    // Execution record was persisted with success status.
    const executions = await listExecutionsByAgentId(db, stored.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe("success");
    expect(executions[0].response).toBe("daily briefing output");
  });

  it("status endpoint reflects registered count and execution metrics after a run", async () => {
    const client = makeMockClient("result");

    await insertAgent(db, {
      name: "Metrics Agent",
      taskDescription: "Run and be counted",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-06-01T09:01:00.000Z"));

    // Query the status endpoint.
    const res = await fetch(`http://localhost:${port}/status`);
    expect(res.status).toBe(200);
    const status = await res.json() as {
      registeredAgents: number;
      enabledAgents: number;
      agentMetrics: Array<{ totalRuns: number; successCount: number }>;
    };

    expect(status.registeredAgents).toBe(1);
    expect(status.enabledAgents).toBe(1);
    expect(status.agentMetrics[0].totalRuns).toBe(1);
    expect(status.agentMetrics[0].successCount).toBe(1);
  });

  it("scheduler does not re-run an agent that already ran in the current minute window", async () => {
    const client = makeMockClient("result");

    await insertAgent(db, {
      name: "Once-Per-Minute Agent",
      taskDescription: "Run only once per minute",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-06-01T10:05:00.000Z");

    // First tick — should run.
    await scheduler.tick(now);
    expect(client.generateText).toHaveBeenCalledTimes(1);

    // Second tick at the same minute — idempotency guard should prevent a second run.
    await scheduler.tick(now);
    expect(client.generateText).toHaveBeenCalledTimes(1); // still 1

    // Tick at the next minute — should run again.
    await scheduler.tick(new Date("2026-06-01T10:06:00.000Z"));
    expect(client.generateText).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown — drain waits for in-flight jobs
// ---------------------------------------------------------------------------

describe("Integration: graceful shutdown", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await openTestDb();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it("drain() resolves once all in-flight runs complete", async () => {
    let resolveRun!: () => void;
    const runStarted = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    // A client that starts, signals, then completes
    let completeRun!: () => void;
    const runCanComplete = new Promise<void>((resolve) => {
      completeRun = resolve;
    });

    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async () => {
        resolveRun(); // signal that the run has started
        await runCanComplete; // wait until the test allows it to finish
        return "done";
      }),
    } as unknown as GeminiClient;

    await insertAgent(db, {
      name: "Slow Agent",
      taskDescription: "Task",
      cronExpression: "* * * * *",
      enabled: true,
    });

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-06-01T10:01:00.000Z");

    // Start the tick but do not await it yet — it will kick off an in-flight run.
    const tickPromise = scheduler.tick(now);

    // Wait until the run has actually started.
    await runStarted;

    // Stop the scheduler (no more new ticks) and begin draining.
    scheduler.stop();
    const drainPromise = scheduler.drain();

    // The drain should still be pending because the run hasn't finished.
    let drained = false;
    void drainPromise.then(() => { drained = true; });

    // Allow the run to complete.
    completeRun();
    await tickPromise;
    await drainPromise;

    expect(drained).toBe(true);
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

describe("Semaphore", () => {
  it("allows up to maxConcurrent tasks to run simultaneously", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let maxObserved = 0;

    const tasks = Array.from({ length: 5 }, () =>
      sem.run(async () => {
        running++;
        maxObserved = Math.max(maxObserved, running);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        running--;
      })
    );

    await Promise.all(tasks);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it("runs all tasks even when concurrency is limited", async () => {
    const sem = new Semaphore(1);
    const results: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        sem.run(async () => {
          results.push(n);
        })
      )
    );

    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

describe("Idempotency helpers", () => {
  describe("getMinuteBoundary", () => {
    it("floors time to the minute", () => {
      const now = new Date("2026-06-01T10:05:42.123Z");
      expect(getMinuteBoundary(now)).toBe("2026-06-01T10:05:00.000Z");
    });

    it("returns correct boundary for a whole-minute time", () => {
      const now = new Date("2026-06-01T10:05:00.000Z");
      expect(getMinuteBoundary(now)).toBe("2026-06-01T10:05:00.000Z");
    });
  });

  describe("hasRunInCurrentWindow", () => {
    it("returns false when lastRunAt is undefined", () => {
      const agent = makeStoredAgent({ lastRunAt: undefined });
      expect(hasRunInCurrentWindow(agent, new Date("2026-06-01T10:05:00.000Z"))).toBe(false);
    });

    it("returns true when lastRunAt is within the current minute window", () => {
      const agent = makeStoredAgent({ lastRunAt: "2026-06-01T10:05:30.000Z" });
      expect(hasRunInCurrentWindow(agent, new Date("2026-06-01T10:05:45.000Z"))).toBe(true);
    });

    it("returns false when lastRunAt is in a different minute", () => {
      const agent = makeStoredAgent({ lastRunAt: "2026-06-01T10:04:59.000Z" });
      expect(hasRunInCurrentWindow(agent, new Date("2026-06-01T10:05:00.000Z"))).toBe(false);
    });

    it("returns true when lastRunAt is exactly at the minute boundary", () => {
      const agent = makeStoredAgent({ lastRunAt: "2026-06-01T10:05:00.000Z" });
      expect(hasRunInCurrentWindow(agent, new Date("2026-06-01T10:05:00.000Z"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

describe("Error types", () => {
  it("AgentNotFoundError has status 404", async () => {
    const { AgentNotFoundError } = await import("../errors");
    const err = new AgentNotFoundError(42);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("42");
    expect(err.name).toBe("AgentNotFoundError");
  });

  it("ValidationError has status 400", async () => {
    const { ValidationError } = await import("../errors");
    const err = new ValidationError("bad input", { field: ["required"] });
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: ["required"] });
  });

  it("DuplicateAgentError has status 409", async () => {
    const { DuplicateAgentError } = await import("../errors");
    const err = new DuplicateAgentError("MyAgent");
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("MyAgent");
  });

  it("ScheduleParseError has status 400", async () => {
    const { ScheduleParseError } = await import("../errors");
    const err = new ScheduleParseError("sometimes", "ambiguous");
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("sometimes");
    expect(err.message).toContain("ambiguous");
  });

  it("errorToHttpStatus maps AppError subclasses correctly", async () => {
    const { AgentNotFoundError, DuplicateAgentError, errorToHttpStatus } = await import("../errors");
    expect(errorToHttpStatus(new AgentNotFoundError("x"))).toBe(404);
    expect(errorToHttpStatus(new DuplicateAgentError("x"))).toBe(409);
    expect(errorToHttpStatus(new Error("generic"))).toBe(500);
    expect(errorToHttpStatus("plain string")).toBe(500);
  });

  it("errorToMessage extracts messages correctly", async () => {
    const { errorToMessage } = await import("../errors");
    expect(errorToMessage(new Error("oops"))).toBe("oops");
    expect(errorToMessage("raw string")).toBe("raw string");
    expect(errorToMessage(42)).toBe("42");
  });
});
