import type { Agent, ExecutionResult } from "./agent";
import type { GeminiClient } from "./geminiClient";
import { buildPrompt } from "./promptBuilder";
import { withRetry, RetryExhaustedError, DEFAULT_RETRY_OPTIONS } from "./retryRunner";

export async function runAgent(
  agent: Agent,
  client: GeminiClient
): Promise<ExecutionResult> {
  const ranAt = new Date();
  const startMs = Date.now();
  const prompt = buildPrompt(agent);

  const timeoutMs = agent.timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs;
  const maxRetries = agent.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
  const backoffBaseMs = agent.backoffBaseMs ?? DEFAULT_RETRY_OPTIONS.backoffBaseMs;

  try {
    const { value: response, attempts } = await withRetry(
      () => client.generateText(prompt),
      { timeoutMs, maxRetries, backoffBaseMs }
    );
    return {
      agentName: agent.name,
      ranAt,
      status: "success",
      response,
      attempts,
      durationMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    const error =
      err instanceof Error ? err.message : String(err);
    const attempts = err instanceof RetryExhaustedError ? err.attempts : 1;
    console.error(
      `[runAgent] Agent "${agent.name}" failed after ${attempts} attempt(s): ${error}`
    );
    return {
      agentName: agent.name,
      ranAt,
      status: "failure",
      error,
      attempts,
      durationMs: Date.now() - startMs,
    };
  }
}
