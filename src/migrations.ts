import type sqlite3 from "sqlite3";
import { dbRun } from "./database";

const CREATE_AGENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    taskDescription TEXT NOT NULL,
    systemPrompt TEXT,
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
    FOREIGN KEY (agentId) REFERENCES agents(id) ON DELETE CASCADE
  )
`;

export async function runMigrations(db: sqlite3.Database): Promise<void> {
  await dbRun(db, "PRAGMA foreign_keys = ON");
  await dbRun(db, CREATE_AGENTS_TABLE);
  await dbRun(db, CREATE_EXECUTIONS_TABLE);
  console.log("[migrations] Migrations completed successfully.");
}
