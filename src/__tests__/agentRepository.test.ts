import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import {
  insertAgent,
  fetchAgentById,
  fetchAgentByName,
  listAgents,
  updateAgent,
  deleteAgent,
  insertExecution,
  listExecutionsByAgentId,
  listExecutionsByAgentName,
} from "../agentRepository";
import type sqlite3 from "sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Agent repository tests
// ---------------------------------------------------------------------------

describe("insertAgent", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("inserts an agent and returns a StoredAgent with an id and timestamps", async () => {
    const stored = await insertAgent(db, {
      name: "Summariser",
      taskDescription: "Summarise TDD benefits",
    });

    expect(stored.id).toBeTypeOf("number");
    expect(stored.name).toBe("Summariser");
    expect(stored.taskDescription).toBe("Summarise TDD benefits");
    expect(stored.systemPrompt).toBeUndefined();
    expect(stored.createdAt).toBeTypeOf("string");
    expect(stored.updatedAt).toBeTypeOf("string");
  });

  it("stores the systemPrompt when provided", async () => {
    const stored = await insertAgent(db, {
      name: "Styled",
      taskDescription: "Explain async/await",
      systemPrompt: "Be concise.",
    });
    expect(stored.systemPrompt).toBe("Be concise.");
  });

  it("throws when inserting a duplicate agent name", async () => {
    await insertAgent(db, { name: "Unique", taskDescription: "Task" });
    await expect(
      insertAgent(db, { name: "Unique", taskDescription: "Another task" })
    ).rejects.toThrow();
  });
});

describe("fetchAgentById", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("returns the agent when found", async () => {
    const inserted = await insertAgent(db, { name: "Alpha", taskDescription: "Task A" });
    const found = await fetchAgentById(db, inserted.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("Alpha");
  });

  it("returns undefined for an unknown id", async () => {
    const found = await fetchAgentById(db, 9999);
    expect(found).toBeUndefined();
  });
});

describe("fetchAgentByName", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("returns the agent when found by name", async () => {
    await insertAgent(db, { name: "Beta", taskDescription: "Task B" });
    const found = await fetchAgentByName(db, "Beta");
    expect(found?.name).toBe("Beta");
  });

  it("returns undefined for an unknown name", async () => {
    const found = await fetchAgentByName(db, "NonExistent");
    expect(found).toBeUndefined();
  });
});

describe("listAgents", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("returns an empty array when no agents exist", async () => {
    const agents = await listAgents(db);
    expect(agents).toEqual([]);
  });

  it("returns all inserted agents sorted by name", async () => {
    await insertAgent(db, { name: "Zebra", taskDescription: "Task Z" });
    await insertAgent(db, { name: "Alpha", taskDescription: "Task A" });
    await insertAgent(db, { name: "Mango", taskDescription: "Task M" });

    const agents = await listAgents(db);
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.name)).toEqual(["Alpha", "Mango", "Zebra"]);
  });
});

describe("updateAgent", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("updates the taskDescription", async () => {
    const inserted = await insertAgent(db, { name: "Gamma", taskDescription: "Old task" });
    const updated = await updateAgent(db, inserted.id, { taskDescription: "New task" });
    expect(updated?.taskDescription).toBe("New task");
  });

  it("updates the name", async () => {
    const inserted = await insertAgent(db, { name: "OldName", taskDescription: "Task" });
    const updated = await updateAgent(db, inserted.id, { name: "NewName" });
    expect(updated?.name).toBe("NewName");
  });

  it("sets the systemPrompt when provided", async () => {
    const inserted = await insertAgent(db, { name: "Delta", taskDescription: "Task D" });
    const updated = await updateAgent(db, inserted.id, { systemPrompt: "Be brief." });
    expect(updated?.systemPrompt).toBe("Be brief.");
  });

  it("clears the systemPrompt when explicitly set to undefined", async () => {
    const inserted = await insertAgent(db, {
      name: "Epsilon",
      taskDescription: "Task E",
      systemPrompt: "Be formal.",
    });
    const updated = await updateAgent(db, inserted.id, { systemPrompt: undefined });
    expect(updated?.systemPrompt ?? null).toBeNull();
  });

  it("returns undefined for a non-existent agent", async () => {
    const result = await updateAgent(db, 9999, { taskDescription: "New task" });
    expect(result).toBeUndefined();
  });

  it("updates the updatedAt timestamp", async () => {
    const inserted = await insertAgent(db, { name: "Zeta", taskDescription: "Task Z" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await updateAgent(db, inserted.id, { taskDescription: "Updated" });
    expect(updated?.updatedAt).not.toBe(inserted.updatedAt);
  });
});

describe("deleteAgent", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("deletes an existing agent and returns true", async () => {
    const inserted = await insertAgent(db, { name: "Theta", taskDescription: "Task T" });
    const deleted = await deleteAgent(db, inserted.id);
    expect(deleted).toBe(true);
    expect(await fetchAgentById(db, inserted.id)).toBeUndefined();
  });

  it("returns false when the agent does not exist", async () => {
    const deleted = await deleteAgent(db, 9999);
    expect(deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Execution repository tests
// ---------------------------------------------------------------------------

describe("insertExecution", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("inserts a success execution and returns a StoredExecution", async () => {
    const agent = await insertAgent(db, { name: "Iota", taskDescription: "Task I" });
    const result = {
      agentName: "Iota",
      ranAt: new Date("2024-01-15T10:00:00Z"),
      status: "success" as const,
      response: "Summary here.",
    };

    const stored = await insertExecution(db, agent.id, result);

    expect(stored.id).toBeTypeOf("number");
    expect(stored.agentId).toBe(agent.id);
    expect(stored.agentName).toBe("Iota");
    expect(stored.ranAt).toBe("2024-01-15T10:00:00.000Z");
    expect(stored.status).toBe("success");
    expect(stored.response).toBe("Summary here.");
    expect(stored.error).toBeUndefined();
  });

  it("inserts a failure execution with error details", async () => {
    const agent = await insertAgent(db, { name: "Kappa", taskDescription: "Task K" });
    const result = {
      agentName: "Kappa",
      ranAt: new Date("2024-01-15T11:00:00Z"),
      status: "failure" as const,
      error: "API timeout",
    };

    const stored = await insertExecution(db, agent.id, result);

    expect(stored.status).toBe("failure");
    expect(stored.error).toBe("API timeout");
    expect(stored.response).toBeUndefined();
  });
});

describe("listExecutionsByAgentId", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("returns an empty array when no executions exist for the agent", async () => {
    const agent = await insertAgent(db, { name: "Lambda", taskDescription: "Task L" });
    const executions = await listExecutionsByAgentId(db, agent.id);
    expect(executions).toEqual([]);
  });

  it("returns all executions for an agent, ordered by most recent first", async () => {
    const agent = await insertAgent(db, { name: "Mu", taskDescription: "Task M" });
    await insertExecution(db, agent.id, {
      agentName: "Mu",
      ranAt: new Date("2024-01-15T08:00:00Z"),
      status: "success",
      response: "First",
    });
    await insertExecution(db, agent.id, {
      agentName: "Mu",
      ranAt: new Date("2024-01-15T09:00:00Z"),
      status: "failure",
      error: "Oops",
    });

    const executions = await listExecutionsByAgentId(db, agent.id);
    expect(executions).toHaveLength(2);
    expect(executions[0].ranAt).toBe("2024-01-15T09:00:00.000Z");
    expect(executions[1].ranAt).toBe("2024-01-15T08:00:00.000Z");
  });

  it("does not return executions from a different agent", async () => {
    const agentA = await insertAgent(db, { name: "Nu", taskDescription: "Task N" });
    const agentB = await insertAgent(db, { name: "Xi", taskDescription: "Task X" });
    await insertExecution(db, agentA.id, {
      agentName: "Nu",
      ranAt: new Date(),
      status: "success",
      response: "A response",
    });

    const executions = await listExecutionsByAgentId(db, agentB.id);
    expect(executions).toHaveLength(0);
  });
});

describe("listExecutionsByAgentName", () => {
  let db: sqlite3.Database;
  beforeEach(async () => { db = await openTestDb(); });
  afterEach(async () => { await closeDatabase(db); });

  it("returns executions filtered by agent name", async () => {
    const agent = await insertAgent(db, { name: "Omicron", taskDescription: "Task O" });
    await insertExecution(db, agent.id, {
      agentName: "Omicron",
      ranAt: new Date("2024-01-15T12:00:00Z"),
      status: "success",
      response: "Done",
    });

    const executions = await listExecutionsByAgentName(db, "Omicron");
    expect(executions).toHaveLength(1);
    expect(executions[0].agentName).toBe("Omicron");
  });

  it("returns empty array for an unknown agent name", async () => {
    const executions = await listExecutionsByAgentName(db, "Unknown");
    expect(executions).toEqual([]);
  });
});
