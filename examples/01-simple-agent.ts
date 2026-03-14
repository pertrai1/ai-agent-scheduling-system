/**
 * Example 01 – Simple Agent
 *
 * Demonstrates the most basic usage of the system: create a GeminiClient,
 * define an agent, run it once, and print the result.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/01-simple-agent.ts
 */

import { loadConfig } from "../src/config";
import { GeminiClient } from "../src/geminiClient";
import { runAgent } from "../src/runAgent";
import type { Agent } from "../src/agent";

void (async () => {
  const config = loadConfig();

  const client = new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });

  const agent: Agent = {
    name: "TDD Summariser",
    taskDescription:
      "Summarise the key benefits of test-driven development in five concise bullet points.",
  };

  console.log(`Running agent: "${agent.name}"…\n`);

  const result = await runAgent(agent, client);

  if (result.status === "success") {
    console.log(`✅ Success (${result.durationMs ?? "?"}ms)`);
    console.log("\nResponse:\n");
    console.log(result.response);
  } else {
    console.error(`❌ Failed after ${result.attempts ?? 1} attempt(s)`);
    console.error("Error:", result.error);
    process.exit(1);
  }
})();
