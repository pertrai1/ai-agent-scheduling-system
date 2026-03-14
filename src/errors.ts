// ---------------------------------------------------------------------------
// Centralized application error types
// ---------------------------------------------------------------------------

/**
 * Base class for all application-level errors.
 * Carries an HTTP status code so API handlers can map errors to responses.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * The requested agent does not exist.
 */
export class AgentNotFoundError extends AppError {
  constructor(identifier: string | number) {
    super(`Agent not found: ${identifier}`, 404);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Input failed validation.
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

/**
 * An agent with the given name already exists.
 */
export class DuplicateAgentError extends AppError {
  constructor(name: string) {
    super(`An agent named "${name}" already exists`, 409);
    this.name = "DuplicateAgentError";
  }
}

/**
 * A natural-language or cron schedule could not be parsed.
 */
export class ScheduleParseError extends AppError {
  constructor(input: string, reason?: string) {
    super(
      reason
        ? `Cannot parse schedule "${input}": ${reason}`
        : `Cannot parse schedule: "${input}"`,
      400
    );
    this.name = "ScheduleParseError";
  }
}

// ---------------------------------------------------------------------------
// Error → HTTP status mapping
// ---------------------------------------------------------------------------

/**
 * Maps any error value to an HTTP status code.
 * Returns the error's own `statusCode` when it is an `AppError`,
 * otherwise defaults to 500.
 */
export function errorToHttpStatus(err: unknown): number {
  if (err instanceof AppError) return err.statusCode;
  return 500;
}

/**
 * Extracts a human-readable message from any error value.
 */
export function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
