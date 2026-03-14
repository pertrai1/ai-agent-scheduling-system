import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const configSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-1.5-flash"),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@example.com"),

  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Maximum number of LLM calls that may run concurrently across all agents.
   * Raising this allows more parallelism; lowering it protects against burst
   * quota exhaustion.  Default: 5.
   */
  MAX_CONCURRENT_LLM: z.coerce.number().int().min(1).default(5),

  /**
   * Milliseconds to wait between launching successive agents that are all due
   * at the same scheduler tick.  Staggering spreads LLM calls over time to
   * avoid burst rate-limit errors.  Set to 0 to disable staggering.
   * Default: 500 ms.
   */
  LLM_STAGGER_MS: z.coerce.number().int().min(0).default(500),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([field, msgs]) => `  ${field}: ${msgs?.join(", ")}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${messages}`);
  }

  return result.data;
}


