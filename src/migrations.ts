import type sqlite3 from "sqlite3";
import { dbRun, dbAll } from "./database";

const CREATE_AGENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    taskDescription TEXT NOT NULL,
    systemPrompt TEXT,
    cronExpression TEXT,
    enabled INTEGER NOT NULL DEFAULT 0,
    lastRunAt TEXT,
    timeoutMs INTEGER NOT NULL DEFAULT 60000,
    maxRetries INTEGER NOT NULL DEFAULT 3,
    backoffBaseMs INTEGER NOT NULL DEFAULT 1000,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`;

const CREATE_EXECUTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agentId INTEGER NOT NULL,
    agentName TEXT NOT NULL,
    ranAt TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    response TEXT,
    error TEXT,
    attempts INTEGER,
    FOREIGN KEY (agentId) REFERENCES agents(id) ON DELETE CASCADE
  )
`;

async function getTableColumns(db: sqlite3.Database, table: string): Promise<string[]> {
  const rows = await dbAll<{ name: string }>(db, `PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function addColumnIfMissing(
  db: sqlite3.Database,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const columns = await getTableColumns(db, table);
  if (!columns.includes(column)) {
    await dbRun(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function runMigrations(db: sqlite3.Database): Promise<void> {
  await dbRun(db, "PRAGMA foreign_keys = ON");
  await dbRun(db, CREATE_AGENTS_TABLE);
  await dbRun(db, CREATE_EXECUTIONS_TABLE);

  // Idempotent column additions for existing databases
  await addColumnIfMissing(db, "agents", "cronExpression", "TEXT");
  await addColumnIfMissing(db, "agents", "enabled", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "agents", "lastRunAt", "TEXT");
  await addColumnIfMissing(db, "agents", "timeoutMs", "INTEGER NOT NULL DEFAULT 60000");
  await addColumnIfMissing(db, "agents", "maxRetries", "INTEGER NOT NULL DEFAULT 3");
  await addColumnIfMissing(db, "agents", "backoffBaseMs", "INTEGER NOT NULL DEFAULT 1000");
  await addColumnIfMissing(db, "executions", "attempts", "INTEGER");

  console.log("[migrations] Migrations completed successfully.");
}
