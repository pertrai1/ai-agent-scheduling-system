import type sqlite3 from "sqlite3";
import type { Agent } from "./agent";
import type { ExecutionResult } from "./agent";
import { dbRun, dbGet, dbAll } from "./database";
import { DEFAULT_RETRY_OPTIONS } from "./retryRunner";

// ---------------------------------------------------------------------------
// Stored types (DB rows include persistence metadata)
// ---------------------------------------------------------------------------

export interface StoredAgent {
  id: number;
  name: string;
  taskDescription: string;
  systemPrompt?: string;
  cronExpression?: string;
  enabled: boolean;
  lastRunAt?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  emailRecipient?: string;
  tools?: string[];
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
  attempts?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Row normalization helpers (SQLite returns null for absent columns)
// ---------------------------------------------------------------------------

type RawAgent = Omit<StoredAgent, "systemPrompt" | "cronExpression" | "lastRunAt" | "enabled" | "timeoutMs" | "maxRetries" | "backoffBaseMs" | "emailRecipient" | "tools"> & {
  systemPrompt: string | null;
  cronExpression: string | null;
  enabled: number;
  lastRunAt: string | null;
  timeoutMs: number | null;
  maxRetries: number | null;
  backoffBaseMs: number | null;
  emailRecipient: string | null;
  tools: string | null;
};
type RawExecution = Omit<StoredExecution, "response" | "error" | "attempts" | "durationMs"> & {
  response: string | null;
  error: string | null;
  attempts: number | null;
  durationMs: number | null;
};

function normalizeAgent(row: RawAgent): StoredAgent {
  return {
    ...row,
    systemPrompt: row.systemPrompt ?? undefined,
    cronExpression: row.cronExpression ?? undefined,
    enabled: !!row.enabled,
    lastRunAt: row.lastRunAt ?? undefined,
    timeoutMs: row.timeoutMs ?? undefined,
    maxRetries: row.maxRetries ?? undefined,
    backoffBaseMs: row.backoffBaseMs ?? undefined,
    emailRecipient: row.emailRecipient ?? undefined,
    tools: row.tools ? (JSON.parse(row.tools) as string[]) : undefined,
  };
}

function normalizeExecution(row: RawExecution): StoredExecution {
  return {
    ...row,
    response: row.response ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts ?? undefined,
    durationMs: row.durationMs ?? undefined,
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
    `INSERT INTO agents (name, taskDescription, systemPrompt, cronExpression, enabled, timeoutMs, maxRetries, backoffBaseMs, emailRecipient, tools, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.name,
      agent.taskDescription,
      agent.systemPrompt ?? null,
      agent.cronExpression ?? null,
      agent.enabled ? 1 : 0,
      agent.timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs,
      agent.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries,
      agent.backoffBaseMs ?? DEFAULT_RETRY_OPTIONS.backoffBaseMs,
      agent.emailRecipient ?? null,
      agent.tools && agent.tools.length > 0 ? JSON.stringify(agent.tools) : null,
      now,
      now,
    ]
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

export type AgentUpdates = Partial<
  Pick<Agent, "name" | "taskDescription" | "systemPrompt" | "cronExpression" | "enabled" | "timeoutMs" | "maxRetries" | "backoffBaseMs" | "emailRecipient" | "tools">
> & { lastRunAt?: string };

export async function updateAgent(
  db: sqlite3.Database,
  id: number,
  updates: AgentUpdates
): Promise<StoredAgent | undefined> {
  const existing = await fetchAgentById(db, id);
  if (!existing) return undefined;

  const updatedAt = new Date().toISOString();
  const name = updates.name ?? existing.name;
  const taskDescription = updates.taskDescription ?? existing.taskDescription;
  const systemPrompt =
    "systemPrompt" in updates ? (updates.systemPrompt ?? null) : existing.systemPrompt ?? null;
  const cronExpression =
    "cronExpression" in updates ? (updates.cronExpression ?? null) : existing.cronExpression ?? null;
  const enabled =
    "enabled" in updates ? (updates.enabled ? 1 : 0) : existing.enabled ? 1 : 0;
  const lastRunAt =
    "lastRunAt" in updates ? (updates.lastRunAt ?? null) : existing.lastRunAt ?? null;
  const timeoutMs =
    "timeoutMs" in updates ? (updates.timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs) : existing.timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs;
  const maxRetries =
    "maxRetries" in updates ? (updates.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries) : existing.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
  const backoffBaseMs =
    "backoffBaseMs" in updates ? (updates.backoffBaseMs ?? DEFAULT_RETRY_OPTIONS.backoffBaseMs) : existing.backoffBaseMs ?? DEFAULT_RETRY_OPTIONS.backoffBaseMs;
  const emailRecipient =
    "emailRecipient" in updates ? (updates.emailRecipient ?? null) : existing.emailRecipient ?? null;
  const tools =
    "tools" in updates
      ? updates.tools && updates.tools.length > 0 ? JSON.stringify(updates.tools) : null
      : existing.tools && existing.tools.length > 0 ? JSON.stringify(existing.tools) : null;

  await dbRun(
    db,
    `UPDATE agents
     SET name = ?, taskDescription = ?, systemPrompt = ?, cronExpression = ?,
         enabled = ?, lastRunAt = ?, timeoutMs = ?, maxRetries = ?, backoffBaseMs = ?, emailRecipient = ?, tools = ?, updatedAt = ?
     WHERE id = ?`,
    [name, taskDescription, systemPrompt, cronExpression, enabled, lastRunAt, timeoutMs, maxRetries, backoffBaseMs, emailRecipient, tools, updatedAt, id]
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

/** Maximum number of execution records retained per agent. */
const MAX_EXECUTIONS_PER_AGENT = 100;

export async function insertExecution(
  db: sqlite3.Database,
  agentId: number,
  result: ExecutionResult
): Promise<StoredExecution> {
  const { lastID } = await dbRun(
    db,
    `INSERT INTO executions (agentId, agentName, ranAt, status, response, error, attempts, durationMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      result.agentName,
      result.ranAt.toISOString(),
      result.status,
      result.response ?? null,
      result.error ?? null,
      result.attempts ?? null,
      result.durationMs ?? null,
    ]
  );

  // Enforce rolling history cap: delete oldest rows beyond the limit
  await dbRun(
    db,
    `DELETE FROM executions
     WHERE agentId = ?
       AND id NOT IN (
         SELECT id FROM executions
         WHERE agentId = ?
         ORDER BY ranAt DESC
         LIMIT ?
       )`,
    [agentId, agentId, MAX_EXECUTIONS_PER_AGENT]
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
