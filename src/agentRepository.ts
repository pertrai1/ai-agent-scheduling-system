import type sqlite3 from "sqlite3";
import type { Agent } from "./agent";
import type { ExecutionResult } from "./agent";
import { dbRun, dbGet, dbAll } from "./database";

// ---------------------------------------------------------------------------
// Stored types (DB rows include persistence metadata)
// ---------------------------------------------------------------------------

export interface StoredAgent {
  id: number;
  name: string;
  taskDescription: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredExecution {
  id: number;
  agentId: number;
  agentName: string;
  ranAt: string;
  status: "success" | "failure";
  response?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Row normalization helpers (SQLite returns null for absent columns)
// ---------------------------------------------------------------------------

type RawAgent = Omit<StoredAgent, "systemPrompt"> & { systemPrompt: string | null };
type RawExecution = Omit<StoredExecution, "response" | "error"> & {
  response: string | null;
  error: string | null;
};

function normalizeAgent(row: RawAgent): StoredAgent {
  return {
    ...row,
    systemPrompt: row.systemPrompt ?? undefined,
  };
}

function normalizeExecution(row: RawExecution): StoredExecution {
  return {
    ...row,
    response: row.response ?? undefined,
    error: row.error ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Agent repository
// ---------------------------------------------------------------------------

export async function insertAgent(
  db: sqlite3.Database,
  agent: Agent
): Promise<StoredAgent> {
  const now = new Date().toISOString();
  const { lastID } = await dbRun(
    db,
    `INSERT INTO agents (name, taskDescription, systemPrompt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`,
    [agent.name, agent.taskDescription, agent.systemPrompt ?? null, now, now]
  );
  const stored = await fetchAgentById(db, lastID);
  if (!stored) throw new Error(`Failed to retrieve agent after insert (id=${lastID})`);
  return stored;
}

export async function fetchAgentById(
  db: sqlite3.Database,
  id: number
): Promise<StoredAgent | undefined> {
  const row = await dbGet<RawAgent>(db, "SELECT * FROM agents WHERE id = ?", [id]);
  return row ? normalizeAgent(row) : undefined;
}

export async function fetchAgentByName(
  db: sqlite3.Database,
  name: string
): Promise<StoredAgent | undefined> {
  const row = await dbGet<RawAgent>(db, "SELECT * FROM agents WHERE name = ?", [name]);
  return row ? normalizeAgent(row) : undefined;
}

export async function listAgents(
  db: sqlite3.Database
): Promise<StoredAgent[]> {
  const rows = await dbAll<RawAgent>(db, "SELECT * FROM agents ORDER BY name ASC");
  return rows.map(normalizeAgent);
}

export async function updateAgent(
  db: sqlite3.Database,
  id: number,
  updates: Partial<Pick<Agent, "name" | "taskDescription" | "systemPrompt">>
): Promise<StoredAgent | undefined> {
  const existing = await fetchAgentById(db, id);
  if (!existing) return undefined;

  const updatedAt = new Date().toISOString();
  const name = updates.name ?? existing.name;
  const taskDescription = updates.taskDescription ?? existing.taskDescription;
  const systemPrompt =
    "systemPrompt" in updates ? (updates.systemPrompt ?? null) : existing.systemPrompt ?? null;

  await dbRun(
    db,
    `UPDATE agents SET name = ?, taskDescription = ?, systemPrompt = ?, updatedAt = ?
     WHERE id = ?`,
    [name, taskDescription, systemPrompt, updatedAt, id]
  );
  return fetchAgentById(db, id);
}

export async function deleteAgent(
  db: sqlite3.Database,
  id: number
): Promise<boolean> {
  const { changes } = await dbRun(db, "DELETE FROM agents WHERE id = ?", [id]);
  return changes > 0;
}

// ---------------------------------------------------------------------------
// Execution repository
// ---------------------------------------------------------------------------

export async function insertExecution(
  db: sqlite3.Database,
  agentId: number,
  result: ExecutionResult
): Promise<StoredExecution> {
  const { lastID } = await dbRun(
    db,
    `INSERT INTO executions (agentId, agentName, ranAt, status, response, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      result.agentName,
      result.ranAt.toISOString(),
      result.status,
      result.response ?? null,
      result.error ?? null,
    ]
  );
  const row = await dbGet<RawExecution>(
    db,
    "SELECT * FROM executions WHERE id = ?",
    [lastID]
  );
  if (!row)
    throw new Error(`Failed to retrieve execution after insert (id=${lastID})`);
  return normalizeExecution(row);
}

export async function listExecutionsByAgentId(
  db: sqlite3.Database,
  agentId: number
): Promise<StoredExecution[]> {
  const rows = await dbAll<RawExecution>(
    db,
    "SELECT * FROM executions WHERE agentId = ? ORDER BY ranAt DESC",
    [agentId]
  );
  return rows.map(normalizeExecution);
}

export async function listExecutionsByAgentName(
  db: sqlite3.Database,
  agentName: string
): Promise<StoredExecution[]> {
  const rows = await dbAll<RawExecution>(
    db,
    "SELECT * FROM executions WHERE agentName = ? ORDER BY ranAt DESC",
    [agentName]
  );
  return rows.map(normalizeExecution);
}
