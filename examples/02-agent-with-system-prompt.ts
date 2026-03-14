/**
 * Example 02 – Agent with a System Prompt
 *
 * Shows how a system prompt shapes the LLM's response style.
 * We run the same task description twice – once without a system prompt
 * and once with a terse, emoji-free technical system prompt – and print
 * both responses side-by-side so the difference is visible.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/02-agent-with-system-prompt.ts
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

  const taskDescription =
    "Explain what an event loop is and why it matters in Node.js.";

  // --- Agent A: no system prompt (default style) ---
  const agentDefault: Agent = {
    name: "Event Loop Explainer (default)",
    taskDescription,
  };

  // --- Agent B: terse technical persona ---
  const agentTerse: Agent = {
    name: "Event Loop Explainer (terse)",
    taskDescription,
    systemPrompt:
      "You are a senior systems engineer. Be concise and technical. " +
      "Avoid marketing language, filler words, and emojis. " +
      "Respond in plain prose, maximum three sentences.",
  };

  async function runAndPrint(agent: Agent): Promise<void> {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Agent: ${agent.name}`);
    console.log(`System prompt: ${agent.systemPrompt ?? "(none)"}`);
    console.log("─".repeat(60));

    const result = await runAgent(agent, client);

    if (result.status === "success") {
      console.log(`✅ ${result.durationMs ?? "?"}ms\n`);
      console.log(result.response);
    } else {
      console.error(`❌ Failed: ${result.error}`);
    }
  }

  await runAndPrint(agentDefault);
  await runAndPrint(agentTerse);
})();
