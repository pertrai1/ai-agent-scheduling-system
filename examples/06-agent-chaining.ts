/**
 * Example 06 – Agent Chaining
 *
 * One agent's output can be passed as context to the next agent, creating
 * a processing pipeline.  This is useful when you want to separate data
 * gathering from formatting or summarisation.
 *
 * Pipeline:
 *   [Researcher] – fetches the GitHub Node.js releases JSON and extracts
 *                  raw version data.
 *   [Formatter]  – receives the researcher's output and produces a
 *                  polished, readable summary for a non-technical audience.
 *
 * The `chainTo` field in the agent definition is used by the scheduler
 * when running agents from the database.  In this standalone example we
 * wire the chain manually by passing `previousOutput` to the second
 * `runAgent` call, which is exactly what the scheduler does internally.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/06-agent-chaining.ts
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

  const toolRegistry = createDefaultToolRegistry();

  // --- Agent 1: Researcher ---
  // Fetches raw release data and returns it as structured text.
  const researcher: Agent = {
    name: "Node.js Release Researcher",
    taskDescription:
      "Fetch https://nodejs.org/dist/index.json and return the five most " +
      "recent Node.js release versions with their dates and LTS status as a " +
      "simple JSON array.  Return only the JSON, no extra text.",
    tools: ["http_get"],
  };

  // --- Agent 2: Formatter ---
  // Receives the researcher's JSON and writes a human-friendly digest.
  const formatter: Agent = {
    name: "Node.js Release Formatter",
    taskDescription:
      "You will receive a JSON array of Node.js release data as the previous " +
      "agent's output.  Rewrite it as a short, friendly paragraph suitable for " +
      "a non-technical project stakeholder.  Mention the version numbers, " +
      "release dates, and whether each release is an LTS version.",
    systemPrompt:
      "You are a clear, friendly technical writer. Use plain English and avoid jargon.",
    // In DB-backed usage, set chainTo: "Node.js Release Formatter" on the
    // researcher agent to trigger this chain automatically.
    chainTo: "Node.js Release Formatter",
  };

  // Step 1: run the researcher
  console.log(`Step 1 – Running researcher: "${researcher.name}"…\n`);
  const researchResult = await runAgent(researcher, client, toolRegistry);

  if (researchResult.status !== "success") {
    console.error(`❌ Researcher failed: ${researchResult.error}`);
    process.exit(1);
  }

  console.log(`✅ Researcher succeeded (${researchResult.durationMs ?? "?"}ms)`);
  console.log("\nRaw output from researcher:\n");
  console.log(researchResult.response);

  // Step 2: run the formatter, passing the researcher's output as context
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Step 2 – Running formatter: "${formatter.name}"…\n`);

  const formatResult = await runAgent(
    formatter,
    client,
    toolRegistry,
    researchResult.response // previousOutput wired from researcher
  );

  if (formatResult.status !== "success") {
    console.error(`❌ Formatter failed: ${formatResult.error}`);
    process.exit(1);
  }

  console.log(`✅ Formatter succeeded (${formatResult.durationMs ?? "?"}ms)\n`);
  console.log("Final output:\n");
  console.log(formatResult.response);
})();
