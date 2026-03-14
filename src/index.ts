import { loadConfig } from "./config";
import { GeminiClient } from "./geminiClient";
import { runAgent } from "./runAgent";
import type { Agent } from "./agent";
import { openDatabase, closeDatabase } from "./database";
import { runMigrations } from "./migrations";
import { Scheduler } from "./scheduler";
import { ApiServer } from "./apiServer";
import { structuredLog } from "./logger";

const config = loadConfig();

const geminiClient = new GeminiClient({
  apiKey: config.GEMINI_API_KEY,
  model: config.GEMINI_MODEL,
});

function logHealth(): void {
  console.log("[AI Agent Scheduling System] Service starting...");
  console.log(`  environment : ${config.NODE_ENV}`);
  console.log(`  log level   : ${config.LOG_LEVEL}`);
  console.log(`  gemini model: ${config.GEMINI_MODEL}`);
  console.log(`  smtp host   : ${config.SMTP_HOST}:${config.SMTP_PORT}`);
  console.log(`  email from  : ${config.EMAIL_FROM}`);
  console.log("[AI Agent Scheduling System] Service is healthy. Ready.");
}

export async function runAgentManually(agent: Agent): Promise<void> {
  console.log(`[index] Running agent manually: ${agent.name}`);
  const result = await runAgent(agent, geminiClient);

  if (result.status === "success") {
    console.log(`[index] Agent "${result.agentName}" succeeded at ${result.ranAt.toISOString()}`);
    console.log(`[index] Response:\n${result.response}`);
  } else {
    console.error(`[index] Agent "${result.agentName}" failed at ${result.ranAt.toISOString()}`);
    console.error(`[index] Error: ${result.error}`);
  }
}

logHealth();

void (async () => {
  const db = openDatabase(process.env.DB_PATH ?? "agents.db");
  try {
    await runMigrations(db);
  } catch (err: unknown) {
    console.error("[index] Migration failed:", err);
    process.exit(1);
  }

  const scheduler = new Scheduler(db, geminiClient, config);
  scheduler.start();

  const port = config.PORT;
  const apiServer = new ApiServer(db, geminiClient);
  const boundPort = await apiServer.start(port);
  console.log(`[index] Management API running on http://localhost:${boundPort}`);

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  let isShuttingDown = false;

  async function shutdown(signal: "SIGTERM" | "SIGINT"): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    structuredLog("info", "index", `Received ${signal}. Starting graceful shutdown…`);

    // 1. Stop the scheduler from scheduling new runs.
    scheduler.stop();

    // 2. Wait for any in-flight agent runs to complete.
    await scheduler.drain();

    // 3. Close the HTTP server (stop accepting new requests).
    try {
      await apiServer.stop();
      structuredLog("info", "index", "API server closed");
    } catch (err: unknown) {
      structuredLog("warn", "index", "Error closing API server", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 4. Close the database connection.
    try {
      await closeDatabase(db);
      structuredLog("info", "index", "Database connection closed");
    } catch (err: unknown) {
      structuredLog("warn", "index", "Error closing database", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    structuredLog("info", "index", "Shutdown complete");
    process.exit(0);
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
})();
