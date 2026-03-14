// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATE_LENGTH = 500;

/**
 * Truncates `text` to at most `maxLength` characters.
 * When truncation occurs, the result ends with "…" so callers can tell
 * the value was cut short.
 */
export function truncate(text: string, maxLength = DEFAULT_TRUNCATE_LENGTH): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  agentName?: string;
  startTime?: string;
  durationMs?: number;
  status?: string;
  attempts?: number;
  summary?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Emits a structured log entry as a single JSON line.
 * Fields are merged with the base entry to allow arbitrary extra context.
 */
export function structuredLog(
  level: LogLevel,
  component: string,
  message: string,
  fields: LogFields = {}
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...fields,
  };
  const output = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(output);
  } else {
    console.log(output);
  }
}

// ---------------------------------------------------------------------------
// Execution lifecycle helpers
// ---------------------------------------------------------------------------

export function logExecutionStart(component: string, agentName: string, startTime: Date): void {
  structuredLog("info", component, "Agent execution started", {
    agentName,
    startTime: startTime.toISOString(),
  });
}

export function logExecutionEnd(
  component: string,
  agentName: string,
  startTime: Date,
  status: "success" | "failure",
  attempts: number,
  responseOrError: string | undefined
): void {
  const durationMs = Date.now() - startTime.getTime();
  const fields: LogFields = {
    agentName,
    startTime: startTime.toISOString(),
    durationMs,
    status,
    attempts,
  };

  if (status === "success") {
    fields.summary = responseOrError ? truncate(responseOrError) : undefined;
  } else {
    fields.error = responseOrError ? truncate(responseOrError) : undefined;
  }

  structuredLog(
    status === "success" ? "info" : "error",
    component,
    `Agent execution ${status}`,
    fields
  );
}
