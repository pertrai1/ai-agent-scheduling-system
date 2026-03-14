import type { Agent } from "./agent";

export function buildPrompt(agent: Agent, previousOutput?: string): string {
  let base = agent.systemPrompt
    ? `${agent.systemPrompt}\n\n${agent.taskDescription}`
    : agent.taskDescription;

  if (previousOutput) {
    base = `Previous agent output:\n${previousOutput}\n\n${base}`;
  }

  return base;
}
