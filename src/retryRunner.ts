export interface RetryOptions {
  maxRetries: number;
  backoffBaseMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  backoffBaseMs: 1_000,
  timeoutMs: 60_000,
};

const MAX_BACKOFF_MS = 60_000;

/**
 * Returns the delay in milliseconds for a given retry attempt using
 * exponential backoff with up to 20% random jitter, capped at MAX_BACKOFF_MS.
 *
 * attempt 0 → backoffBaseMs * 1  (base delay before first retry)
 * attempt 1 → backoffBaseMs * 2
 * attempt 2 → backoffBaseMs * 4
 * …
 */
export function calculateBackoffDelay(attempt: number, backoffBaseMs: number): number {
  const base = Math.min(backoffBaseMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * base * 0.2);
  return base + jitter;
}

/**
 * Wraps `fn` so that it rejects with a timeout error if it does not
 * settle within `timeoutMs` milliseconds.  The internal timer is
 * always cleared when the wrapped promise settles to avoid leaks.
 */
export function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface RetryResult<T> {
  value: T;
  /** Total number of attempts made (1 = succeeded on first try). */
  attempts: number;
}

/**
 * Thrown by `withRetry` when all attempts have been exhausted.
 * The `attempts` property reflects the actual number of calls made.
 */
export class RetryExhaustedError extends Error {
  constructor(
    cause: unknown,
    public readonly attempts: number
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RetryExhaustedError";
    this.cause = cause;
  }
}

/**
 * Executes `fn` with timeout wrapping and retries up to `maxRetries`
 * additional times on failure, using exponential backoff with jitter
 * between attempts.
 *
 * Resolves with `{ value, attempts }` on success.
 * Throws `RetryExhaustedError` (with `attempts` set) when all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;
  let attemptsMade = 0;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    attemptsMade++;
    try {
      const value = await withTimeout(fn, opts.timeoutMs);
      return { value, attempts: attemptsMade };
    } catch (err: unknown) {
      lastError = err;
      if (attempt < opts.maxRetries) {
        const delay = calculateBackoffDelay(attempt, opts.backoffBaseMs);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new RetryExhaustedError(lastError, attemptsMade);
}
