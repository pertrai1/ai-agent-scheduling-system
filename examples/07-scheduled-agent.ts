/**
 * Example 07 – Scheduled Agent (Cron + SQLite)
 *
 * Shows the full scheduling pipeline:
 *   1. Open an in-memory SQLite database and run schema migrations.
 *   2. Insert an agent with a cron expression (every minute: "* * * * *").
 *   3. Start the Scheduler, which ticks every 60 seconds and runs any due agents.
 *   4. Wait for two ticks to observe at least one execution, then shut down.
 *
 * Because a real minute would be too long to wait in a demo, the scheduler
 * tick interval is left at its default but we force-call the internal tick
 * method directly after a short delay to demonstrate execution without
 * blocking for 60 seconds.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/07-scheduled-agent.ts
 */

import { loadConfig } from "../src/config";
import { GeminiClient } from "../src/geminiClient";
import { openDatabase } from "../src/database";
import { runMigrations } from "../src/migrations";
import { insertAgent, listExecutionsByAgentId } from "../src/agentRepository";
import { Scheduler } from "../src/scheduler";
import { createDefaultToolRegistry } from "../src/builtinTools";

void (async () => {
  const config = loadConfig();

  const client = new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });

  // Use an in-memory database so the example leaves no files on disk.
  const db = openDatabase(":memory:");
  await runMigrations(db);

  // Insert an agent scheduled to run every minute.
  const storedAgent = await insertAgent(db, {
    name: "Scheduled Haiku Writer",
    taskDescription:
      "Write a single haiku (three lines: 5-7-5 syllables) about software reliability.",
    cronExpression: "* * * * *",
    enabled: true,
    maxRetries: 1,
    timeoutMs: 30_000,
  });

  console.log(`✅ Agent inserted with id=${storedAgent.id}`);
  console.log("Starting scheduler…\n");

  const scheduler = new Scheduler(
    db,
    client,
    config,
    1, // only one concurrent LLM call for this demo
    createDefaultToolRegistry(),
    0  // no stagger delay
  );

  scheduler.start();

  // Give the scheduler one tick to run the agent (the isAgentDueNow check uses
  // the current wall-clock minute, so we wait a moment for the tick to fire).
  console.log("Waiting 5 seconds for the scheduler tick…");
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  // Stop the scheduler gracefully.
  scheduler.stop();
  await scheduler.drain();

  // Print execution history.
  const executions = await listExecutionsByAgentId(db, storedAgent.id);

  if (executions.length === 0) {
    console.log(
      "\n⏳ No executions recorded yet (the cron expression fires on the minute boundary)."
    );
    console.log(
      "   In a production deployment the scheduler would fire at the next full minute."
    );
  } else {
    console.log(`\n📋 Execution history (${executions.length} record(s)):\n`);
    for (const exec of executions) {
      console.log(`  [${exec.ranAt}] status=${exec.status}  duration=${exec.durationMs ?? "?"}ms`);
      if (exec.status === "success") {
        console.log(`  Response:\n${exec.response}\n`);
      } else {
        console.log(`  Error: ${exec.error}\n`);
      }
    }
  }

  process.exit(0);
})();
