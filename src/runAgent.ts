import type { Agent, ExecutionResult } from "./agent";
import type { GeminiClient } from "./geminiClient";
import { buildPrompt } from "./promptBuilder";
import { withRetry, RetryExhaustedError, DEFAULT_RETRY_OPTIONS } from "./retryRunner";
import type { ToolRegistry } from "./toolRegistry";

export async function runAgent(
  agent: Agent,
  client: GeminiClient,
  toolRegistry?: ToolRegistry
): Promise<ExecutionResult> {
  const ranAt = new Date();
  const startMs = Date.now();
  const prompt = buildPrompt(agent);

  const timeoutMs = agent.timeoutMs ?? DEFAULT_RETRY_OPTIONS.timeoutMs;
  const maxRetries = agent.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
  const backoffBaseMs = agent.backoffBaseMs ?? DEFAULT_RETRY_OPTIONS.backoffBaseMs;

  // Resolve tool definitions for the tools requested by this agent.
  const toolDefinitions =
    toolRegistry && agent.tools && agent.tools.length > 0
      ? toolRegistry.getDefinitionsForNames(agent.tools)
      : [];

  // Warn if the agent requests tools that are not registered.
  if (toolRegistry && agent.tools && agent.tools.length > 0) {
    const missing = agent.tools.filter((name) => !toolRegistry.has(name));
    if (missing.length > 0) {
      console.warn(
        `[runAgent] Agent "${agent.name}" references unknown tools: ${missing.join(", ")}. These will be skipped.`
      );
    }
  }

  // Use tool-enabled generation when tools are available, plain text otherwise.
  const generateFn =
    toolDefinitions.length > 0 && toolRegistry
      ? () =>
          client.generateWithTools(
            prompt,
            toolDefinitions,
            (name, args) => toolRegistry.execute(name, args)
          )
      : () => client.generateText(prompt);

  try {
    const { value: response, attempts } = await withRetry(generateFn, {
      timeoutMs,
      maxRetries,
      backoffBaseMs,
    });
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
