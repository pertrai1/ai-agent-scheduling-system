import { z } from "zod";
import type { GeminiClient } from "./geminiClient";
import { validateCronExpression } from "./cronValidator";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

const ParsedScheduleSchema = z.object({
  cron: z.string(),
  description: z.string(),
  notes: z.string().optional(),
});

const ParseScheduleErrorSchema = z.object({
  error: z.string(),
});

export type ParsedSchedule = z.infer<typeof ParsedScheduleSchema>;
export type ParseScheduleError = z.infer<typeof ParseScheduleErrorSchema>;
export type ParseScheduleResult = ParsedSchedule | ParseScheduleError;

/** Type guard: returns true when the result is a successfully parsed schedule. */
export function isParsedSchedule(
  result: ParseScheduleResult
): result is ParsedSchedule {
  return "cron" in result;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PARSE_PROMPT = `You are a cron expression parser. Convert natural language schedule descriptions into standard five-field cron expressions (minute hour day-of-month month day-of-week).

Respond ONLY with valid JSON in one of these two formats:

Success:
{"cron": "<expression>", "description": "<human readable description>", "notes": "<optional notes>"}

Error (ambiguous or unparseable):
{"error": "<clear explanation of what is ambiguous and how the user can rephrase>"}

Examples:
- "every day at 7am"        -> {"cron": "0 7 * * *",   "description": "Every day at 7:00 AM"}
- "every weekday at 9am"    -> {"cron": "0 9 * * 1-5", "description": "Every weekday (Monday–Friday) at 9:00 AM"}
- "every Monday at 8am"     -> {"cron": "0 8 * * 1",   "description": "Every Monday at 8:00 AM"}
- "every 3 hours"           -> {"cron": "0 */3 * * *", "description": "Every 3 hours"}
- "twice a day"             -> {"cron": "0 9,18 * * *", "description": "Twice a day at 9:00 AM and 6:00 PM"}
- "sometimes in the morning"-> {"error": "The schedule 'sometimes in the morning' is ambiguous – please specify a time, e.g. 'every day at 9am'."}

Important rules:
1. Return ONLY the JSON object, no markdown fences or extra text.
2. Use the five-field cron format (no seconds field).
3. If the input cannot be unambiguously converted, always return the error shape.`;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a natural language schedule description into a cron expression using
 * the provided LLM client.  Returns a `ParsedSchedule` on success, or a
 * `ParseScheduleError` when the input is ambiguous, unparseable, or the LLM
 * call fails.
 */
export async function parseNaturalLanguageSchedule(
  input: string,
  client: GeminiClient
): Promise<ParseScheduleResult> {
  if (!input.trim()) {
    return { error: "Schedule description cannot be empty. Please provide a description such as 'every day at 9am'." };
  }

  const prompt = `${PARSE_PROMPT}\n\nParse this schedule: "${input}"`;

  let raw: string;
  try {
    raw = await client.generateText(prompt);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to parse schedule: ${message}` };
  }

  // Try to parse the response as JSON directly first (clean LLM output),
  // then fall back to extracting a JSON object from markdown-fenced output.
  let parsed: unknown;
  const directParse = (() => {
    try {
      return JSON.parse(raw.trim()) as unknown;
    } catch {
      return null;
    }
  })();

  if (directParse !== null) {
    parsed = directParse;
  } else {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        error:
          "Could not interpret the schedule. Please try rephrasing (e.g. 'every day at 9am').",
      };
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        error:
          "Could not interpret the schedule. Please try rephrasing (e.g. 'every day at 9am').",
      };
    }
  }

  // If the object has an "error" key (and no "cron" key), treat it as an error
  const errResult = ParseScheduleErrorSchema.safeParse(parsed);
  if (
    errResult.success &&
    typeof parsed === "object" &&
    parsed !== null &&
    !("cron" in parsed)
  ) {
    return errResult.data;
  }

  // Otherwise expect a success shape
  const successResult = ParsedScheduleSchema.safeParse(parsed);
  if (!successResult.success) {
    return {
      error:
        "Could not interpret the schedule. Please try rephrasing (e.g. 'every day at 9am').",
    };
  }

  const { cron, description, notes } = successResult.data;

  // Post-parse validation: ensure the cron expression is actually valid
  if (!validateCronExpression(cron)) {
    return {
      error: `The interpreted cron expression "${cron}" is not valid. Please try rephrasing your schedule.`,
    };
  }

  return { cron, description, notes };
}

// ---------------------------------------------------------------------------
// Confirmation helper
// ---------------------------------------------------------------------------

/**
 * Format a human-readable confirmation message for a successfully parsed
 * schedule.  Show this to the user before saving the cron expression so they
 * can verify the interpretation is correct.
 */
export function formatScheduleConfirmation(schedule: ParsedSchedule): string {
  let msg =
    `Schedule interpreted as: ${schedule.description}\n` +
    `Cron expression: ${schedule.cron}`;
  if (schedule.notes) {
    msg += `\nNote: ${schedule.notes}`;
  }
  return msg;
}
