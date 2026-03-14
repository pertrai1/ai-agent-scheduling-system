import { z } from "zod";

export const AgentSchema = z.object({
  name: z.string().min(1, "Agent name is required"),
  taskDescription: z.string().min(1, "Task description is required"),
  systemPrompt: z.string().optional(),
  cronExpression: z.string().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
  backoffBaseMs: z.number().int().positive().optional(),
  emailRecipient: z.string().email().optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const ExecutionResultSchema = z.object({
  agentName: z.string(),
  ranAt: z.date(),
  status: z.enum(["success", "failure"]),
  response: z.string().optional(),
  error: z.string().optional(),
  attempts: z.number().int().min(1).optional(),
  durationMs: z.number().int().min(0).optional(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
