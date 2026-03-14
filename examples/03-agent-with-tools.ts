/**
 * Example 03 – Agent with Built-in Tools
 *
 * Demonstrates how to give an agent access to built-in tools so it can
 * gather live data before answering.  This example registers three tools:
 *
 *   • current_time       – lets the model know the real UTC timestamp
 *   • http_get           – allows the model to fetch a URL
 *   • fetch_webpage_text – fetches a page and strips the HTML
 *
 * The agent is asked for a brief status report about the Node.js project,
 * relying on the model to decide which tools to call and how.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/03-agent-with-tools.ts
 */

import { loadConfig } from "../src/config";
import { GeminiClient } from "../src/geminiClient";
import { runAgent } from "../src/runAgent";
import { createDefaultToolRegistry } from "../src/builtinTools";
import type { Agent } from "../src/agent";

void (async () => {
  const config = loadConfig();

  const client = new GeminiClient({
    apiKey: config.GEMINI_API_KEY,
    model: config.GEMINI_MODEL,
  });

  // Build the default tool registry (current_time, http_get, fetch_rss,
  // fetch_json, fetch_webpage_text).
  const toolRegistry = createDefaultToolRegistry();

  const agent: Agent = {
    name: "Node.js Release Reporter",
    taskDescription:
      "Fetch the Node.js releases page at https://nodejs.org/en/about/previous-releases " +
      "and tell me the three most recent major Node.js releases with their status " +
      "(Active LTS, Maintenance, etc.).  Also include today's date in your answer.",
    // Declare which tools this agent is allowed to use.
    tools: ["current_time", "fetch_webpage_text"],
  };

  console.log(`Running agent: "${agent.name}"…`);
  console.log(`Enabled tools : ${agent.tools?.join(", ") ?? "none"}\n`);

  const result = await runAgent(agent, client, toolRegistry);

  if (result.status === "success") {
    console.log(`✅ Success (${result.durationMs ?? "?"}ms)\n`);
    console.log(result.response);
  } else {
    console.error(`❌ Failed after ${result.attempts ?? 1} attempt(s): ${result.error}`);
    process.exit(1);
  }
})();
