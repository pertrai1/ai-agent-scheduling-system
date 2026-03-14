import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { insertExecution } from "../agentRepository";
import { ApiServer } from "../apiServer";
import { Scheduler } from "../scheduler";
import type sqlite3 from "sqlite3";
import type { GeminiClient } from "../geminiClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

function makeMockClient(response = "ok"): GeminiClient {
  return {
    generateText: vi.fn().mockResolvedValue(response),
  } as unknown as GeminiClient;
}

async function startTestServer(
  db: sqlite3.Database,
  client?: GeminiClient
): Promise<{ server: ApiServer; port: number }> {
  const server = new ApiServer(db, client);
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

async function apiPatch(
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = res.status === 204 ? null : await res.json();
  return { status: res.status, body: responseBody };
}

async function apiDelete(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}${path}`, { method: "DELETE" });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// GET /agents
// ---------------------------------------------------------------------------

describe("GET /agents", () => {
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

  it("returns an empty array when no agents exist", async () => {
    const { status, body } = await apiGet(port, "/agents");
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns all agents after creation", async () => {
    await apiPost(port, "/agents", { name: "Alpha", taskDescription: "Task A" });
    await apiPost(port, "/agents", { name: "Beta", taskDescription: "Task B" });
    const { status, body } = await apiGet(port, "/agents");
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// POST /agents
// ---------------------------------------------------------------------------

describe("POST /agents", () => {
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

  it("creates an agent and returns 201 with the stored agent", async () => {
    const { status, body } = await apiPost(port, "/agents", {
      name: "My Agent",
      taskDescription: "Summarise TDD",
    });
    expect(status).toBe(201);
    const agent = body as Record<string, unknown>;
    expect(agent.id).toBeTypeOf("number");
    expect(agent.name).toBe("My Agent");
    expect(agent.taskDescription).toBe("Summarise TDD");
    expect(agent.enabled).toBe(false);
  });

  it("stores cron expression when a valid cron scheduleInput is provided", async () => {
    const { status, body } = await apiPost(port, "/agents", {
      name: "Cron Agent",
      taskDescription: "Run on schedule",
      scheduleInput: "0 7 * * *",
      enabled: true,
    });
    expect(status).toBe(201);
    const agent = body as Record<string, unknown>;
    expect(agent.cronExpression).toBe("0 7 * * *");
    expect(agent.enabled).toBe(true);
  });

  it("returns 400 when required fields are missing", async () => {
    const { status, body } = await apiPost(port, "/agents", { name: "No Task" });
    expect(status).toBe(400);
    const err = body as Record<string, unknown>;
    expect(err.error).toBe("Validation failed");
  });

  it("returns 400 when emailRecipient is not a valid email", async () => {
    const { status, body } = await apiPost(port, "/agents", {
      name: "Bad Email",
      taskDescription: "Task",
      emailRecipient: "not-an-email",
    });
    expect(status).toBe(400);
    const err = body as Record<string, unknown>;
    expect(err.error).toBe("Validation failed");
  });

  it("returns 409 when an agent with the same name already exists", async () => {
    await apiPost(port, "/agents", { name: "Duplicate", taskDescription: "Task" });
    const { status, body } = await apiPost(port, "/agents", {
      name: "Duplicate",
      taskDescription: "Task",
    });
    expect(status).toBe(409);
    const err = body as Record<string, unknown>;
    expect(typeof err.error).toBe("string");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await fetch(`http://localhost:${port}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("uses NL schedule parsing when scheduleInput is not a valid cron", async () => {
    const mockClient = makeMockClient(
      JSON.stringify({ cron: "0 7 * * *", description: "Every day at 7am" })
    );
    const { server: nlServer, port: nlPort } = await startTestServer(db, mockClient);
    try {
      const { status, body } = await apiPost(nlPort, "/agents", {
        name: "NL Agent",
        taskDescription: "Run daily",
        scheduleInput: "every day at 7am",
      });
      expect(status).toBe(201);
      const agent = body as Record<string, unknown>;
      expect(agent.cronExpression).toBe("0 7 * * *");
    } finally {
      await nlServer.stop();
    }
  });

  it("returns 400 when scheduleInput cannot be parsed as cron and no client is available", async () => {
    const { status, body } = await apiPost(port, "/agents", {
      name: "NL No Client",
      taskDescription: "Run",
      scheduleInput: "every day at 7am",
    });
    expect(status).toBe(400);
    const err = body as Record<string, unknown>;
    expect(typeof err.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:id
// ---------------------------------------------------------------------------

describe("GET /agents/:id", () => {
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

  it("returns the agent when found", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Found",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const { status, body } = await apiGet(port, `/agents/${agent.id as number}`);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).name).toBe("Found");
  });

  it("returns 404 for a non-existent id", async () => {
    const { status } = await apiGet(port, "/agents/9999");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /agents/:id
// ---------------------------------------------------------------------------

describe("PATCH /agents/:id", () => {
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

  it("updates agent fields and returns the updated agent", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Old Name",
      taskDescription: "Old task",
    });
    const agent = created as Record<string, unknown>;
    const { status, body } = await apiPatch(port, `/agents/${agent.id as number}`, {
      name: "New Name",
      taskDescription: "New task",
    });
    expect(status).toBe(200);
    const updated = body as Record<string, unknown>;
    expect(updated.name).toBe("New Name");
    expect(updated.taskDescription).toBe("New task");
  });

  it("updates the cron expression via scheduleInput", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Schedule Change",
      taskDescription: "Task",
      scheduleInput: "0 8 * * *",
    });
    const agent = created as Record<string, unknown>;
    const { status, body } = await apiPatch(port, `/agents/${agent.id as number}`, {
      scheduleInput: "0 9 * * *",
    });
    expect(status).toBe(200);
    const updated = body as Record<string, unknown>;
    expect(updated.cronExpression).toBe("0 9 * * *");
  });

  it("returns 404 when agent does not exist", async () => {
    const { status } = await apiPatch(port, "/agents/9999", { enabled: true });
    expect(status).toBe(404);
  });

  it("returns 400 for validation errors", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "Valid Agent",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const { status, body } = await apiPatch(port, `/agents/${agent.id as number}`, {
      timeoutMs: -1,
    });
    expect(status).toBe(400);
    const err = body as Record<string, unknown>;
    expect(err.error).toBe("Validation failed");
  });
});

// ---------------------------------------------------------------------------
// DELETE /agents/:id
// ---------------------------------------------------------------------------

describe("DELETE /agents/:id", () => {
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

  it("deletes an existing agent and returns 204", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "To Delete",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const { status } = await apiDelete(port, `/agents/${agent.id as number}`);
    expect(status).toBe(204);

    const { status: getStatus } = await apiGet(port, `/agents/${agent.id as number}`);
    expect(getStatus).toBe(404);
  });

  it("returns 404 when agent does not exist", async () => {
    const { status } = await apiDelete(port, "/agents/9999");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /agents/:id/executions
// ---------------------------------------------------------------------------

describe("GET /agents/:id/executions", () => {
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

  it("returns an empty array when no executions exist", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "No Runs",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    const { status, body } = await apiGet(port, `/agents/${agent.id as number}/executions`);
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("returns execution history for the agent", async () => {
    const { body: created } = await apiPost(port, "/agents", {
      name: "With Runs",
      taskDescription: "Task",
    });
    const agent = created as Record<string, unknown>;
    await insertExecution(db, agent.id as number, {
      agentName: "With Runs",
      ranAt: new Date("2024-01-15T10:00:00Z"),
      status: "success",
      response: "Done",
    });

    const { status, body } = await apiGet(port, `/agents/${agent.id as number}/executions`);
    expect(status).toBe(200);
    const execs = body as unknown[];
    expect(execs).toHaveLength(1);
    const exec = execs[0] as Record<string, unknown>;
    expect(exec.status).toBe("success");
    expect(exec.response).toBe("Done");
  });

  it("returns 404 when the agent does not exist", async () => {
    const { status } = await apiGet(port, "/agents/9999/executions");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Scheduler integration — Phase 7 ROADMAP tests
// ---------------------------------------------------------------------------

describe("Scheduler integration", () => {
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

  it("creates an agent via API and the scheduler picks it up on the next tick", async () => {
    const client = makeMockClient("summary result");
    const { body: created } = await apiPost(port, "/agents", {
      name: "API Created Agent",
      taskDescription: "Summarise something",
      scheduleInput: "* * * * *",
      enabled: true,
    });
    const agent = created as Record<string, unknown>;
    expect(agent.enabled).toBe(true);
    expect(agent.cronExpression).toBe("* * * * *");

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    // Verify execution was recorded
    const { body: executions } = await apiGet(port, `/agents/${agent.id as number}/executions`);
    expect((executions as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });

  it("edits an agent schedule via API and the scheduler uses the new timing", async () => {
    const client = makeMockClient("result");
    // Create agent with a specific schedule that won't fire at 10:01
    const { body: created } = await apiPost(port, "/agents", {
      name: "Schedule Edit Agent",
      taskDescription: "Task",
      scheduleInput: "0 8 * * *",
      enabled: true,
    });
    const agent = created as Record<string, unknown>;

    const scheduler = new Scheduler(db, client);
    const nonMatchingTime = new Date("2026-01-01T10:01:00.000Z");

    // First tick — should NOT fire (schedule is 0 8 * * *)
    await scheduler.tick(nonMatchingTime);
    expect(client.generateText).not.toHaveBeenCalled();

    // Change schedule to "every minute" via PATCH
    await apiPatch(port, `/agents/${agent.id as number}`, {
      scheduleInput: "* * * * *",
    });

    // Second tick at the same time — should NOW fire with new schedule
    await scheduler.tick(nonMatchingTime);
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });

  it("deletes an agent via API and the scheduler stops running it", async () => {
    const client = makeMockClient("result");
    const { body: created } = await apiPost(port, "/agents", {
      name: "Soon Deleted",
      taskDescription: "Task",
      scheduleInput: "* * * * *",
      enabled: true,
    });
    const agent = created as Record<string, unknown>;

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");

    // First tick — agent should run
    await scheduler.tick(now);
    expect(client.generateText).toHaveBeenCalledTimes(1);

    // Delete via API
    const { status } = await apiDelete(port, `/agents/${agent.id as number}`);
    expect(status).toBe(204);

    // Second tick — agent is gone, should not run
    await scheduler.tick(new Date("2026-01-01T10:02:00.000Z"));
    expect(client.generateText).toHaveBeenCalledTimes(1); // still 1, not 2
  });
});

// ---------------------------------------------------------------------------
// Restart persistence — agents and execution history survive DB reconnect
// ---------------------------------------------------------------------------

describe("Restart persistence", () => {
  let tmpFile: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
    tmpFile = path.join(tmpDir, "test.db");
  });
  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it("agents and execution history are preserved after DB reconnect", async () => {
    // ---- Session 1: create agents and executions ----
    const db1 = openDatabase(tmpFile);
    await runMigrations(db1);
    const server1 = new ApiServer(db1);
    const port1 = await server1.start(0);

    const { body: created } = await apiPost(port1, "/agents", {
      name: "Persistent Agent",
      taskDescription: "Persist me",
      scheduleInput: "0 9 * * *",
      enabled: true,
    });
    const agent = created as Record<string, unknown>;

    await insertExecution(db1, agent.id as number, {
      agentName: "Persistent Agent",
      ranAt: new Date("2024-06-01T09:00:00Z"),
      status: "success",
      response: "Stored response",
    });

    await server1.stop();
    await closeDatabase(db1);

    // ---- Session 2: reopen same file and verify data survived ----
    const db2 = openDatabase(tmpFile);
    await runMigrations(db2);
    const server2 = new ApiServer(db2);
    const port2 = await server2.start(0);

    try {
      const { status: listStatus, body: agents } = await apiGet(port2, "/agents");
      expect(listStatus).toBe(200);
      const agentList = agents as Array<Record<string, unknown>>;
      expect(agentList).toHaveLength(1);
      expect(agentList[0].name).toBe("Persistent Agent");
      expect(agentList[0].cronExpression).toBe("0 9 * * *");
      expect(agentList[0].enabled).toBe(true);

      const { status: execStatus, body: executions } = await apiGet(
        port2,
        `/agents/${agentList[0].id as number}/executions`
      );
      expect(execStatus).toBe(200);
      const execList = executions as Array<Record<string, unknown>>;
      expect(execList).toHaveLength(1);
      expect(execList[0].status).toBe("success");
      expect(execList[0].response).toBe("Stored response");
    } finally {
      await server2.stop();
      await closeDatabase(db2);
    }
  });
});
