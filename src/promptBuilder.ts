import type { Agent } from "./agent";

export function buildPrompt(agent: Agent): string {
  if (agent.systemPrompt) {
    return `${agent.systemPrompt}\n\n${agent.taskDescription}`;
  }
  return agent.taskDescription;
}
