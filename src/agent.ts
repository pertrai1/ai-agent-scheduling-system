import { z } from "zod";

export const AgentSchema = z.object({
  name: z.string().min(1, "Agent name is required"),
  taskDescription: z.string().min(1, "Task description is required"),
  systemPrompt: z.string().optional(),
  cronExpression: z.string().optional(),
  enabled: z.boolean().optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const ExecutionResultSchema = z.object({
  agentName: z.string(),
  ranAt: z.date(),
  status: z.enum(["success", "failure"]),
  response: z.string().optional(),
  error: z.string().optional(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
