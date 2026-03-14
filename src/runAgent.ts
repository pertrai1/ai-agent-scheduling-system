import type { Agent, ExecutionResult } from "./agent";
import type { GeminiClient } from "./geminiClient";
import { buildPrompt } from "./promptBuilder";

export async function runAgent(
  agent: Agent,
  client: GeminiClient
): Promise<ExecutionResult> {
  const ranAt = new Date();
  const prompt = buildPrompt(agent);

  try {
    const response = await client.generateText(prompt);
    return {
      agentName: agent.name,
      ranAt,
      status: "success",
      response,
    };
  } catch (err: unknown) {
    const error =
      err instanceof Error ? err.message : String(err);
    console.error(`[runAgent] Agent "${agent.name}" failed: ${error}`);
    return {
      agentName: agent.name,
      ranAt,
      status: "failure",
      error,
    };
  }
}
