/**
 * Example 04 – Resilient Agent (Timeout & Retry)
 *
 * Shows how to configure per-agent timeout and retry behaviour.
 *
 *   timeoutMs      – abort the LLM call if it takes longer than this
 *   maxRetries     – number of additional attempts after the first failure
 *   backoffBaseMs  – base delay for exponential back-off between retries
 *
 * To see retry behaviour in action you can temporarily set
 * GEMINI_API_KEY to an invalid value so every call fails, or lower
 * timeoutMs to something very short (e.g. 1) to force a timeout.
 *
 * Run with:
 *   GEMINI_API_KEY=<your-key> npx tsx examples/04-resilient-agent.ts
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
    name: "Resilient Summariser",
    taskDescription:
      "Give me a one-paragraph summary of what makes a microservices architecture resilient.",

    // Abort the LLM call if it takes longer than 30 seconds.
    timeoutMs: 30_000,

    // Retry up to 3 times on failure.
    maxRetries: 3,

    // Start with a 500 ms delay; each retry doubles it (capped at 60 s).
    backoffBaseMs: 500,
  };

  console.log(`Running agent: "${agent.name}"`);
  console.log(
    `Config: timeout=${agent.timeoutMs}ms  maxRetries=${agent.maxRetries}  backoffBase=${agent.backoffBaseMs}ms\n`
  );

  const result = await runAgent(agent, client);

  if (result.status === "success") {
    console.log(
      `✅ Succeeded on attempt ${result.attempts ?? 1} of ${(agent.maxRetries ?? 0) + 1} (${result.durationMs ?? "?"}ms)\n`
    );
    console.log(result.response);
  } else {
    console.error(
      `❌ Permanently failed after ${result.attempts ?? 1} attempt(s)`
    );
    console.error("Error:", result.error);
    process.exit(1);
  }
})();
