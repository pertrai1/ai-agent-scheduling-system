import { loadConfig } from "./config";
import { GeminiClient } from "./geminiClient";
import { runAgent } from "./runAgent";
import type { Agent } from "./agent";
import { openDatabase } from "./database";
import { runMigrations } from "./migrations";

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
})();
