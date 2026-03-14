import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  withTimeout,
  calculateBackoffDelay,
  DEFAULT_RETRY_OPTIONS,
  RetryExhaustedError,
} from "../retryRunner";
import { runAgent } from "../runAgent";
import type { Agent } from "../agent";
import type { GeminiClient } from "../geminiClient";
import { Scheduler } from "../scheduler";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { insertAgent, listExecutionsByAgentId } from "../agentRepository";
import type sqlite3 from "sqlite3";

// ---------------------------------------------------------------------------
// calculateBackoffDelay – pure function
// ---------------------------------------------------------------------------

describe("calculateBackoffDelay", () => {
  it("returns at least backoffBaseMs on attempt 0", () => {
    const delay = calculateBackoffDelay(0, 1000);
    expect(delay).toBeGreaterThanOrEqual(1000);
  });

  it("returns at least 2× backoffBaseMs on attempt 1", () => {
    const delay = calculateBackoffDelay(1, 1000);
    expect(delay).toBeGreaterThanOrEqual(2000);
  });

  it("returns at least 4× backoffBaseMs on attempt 2", () => {
    const delay = calculateBackoffDelay(2, 1000);
    expect(delay).toBeGreaterThanOrEqual(4000);
  });

  it("backoff delays increase across consecutive attempts", () => {
    // Use a fixed seed-like check: base (no jitter) doubles each step.
    // We confirm the minimum bound rises: base0 < base1 < base2.
    const base = 100;
    const delay0 = calculateBackoffDelay(0, base);
    const delay1 = calculateBackoffDelay(1, base);
    const delay2 = calculateBackoffDelay(2, base);

    // Minimum base doubles each attempt, so delay0 must be < delay2
    // even with maximum jitter (20%): delay0 max = 120, delay2 min = 400
    expect(delay0).toBeGreaterThanOrEqual(base);
    expect(delay1).toBeGreaterThanOrEqual(base * 2);
    expect(delay2).toBeGreaterThanOrEqual(base * 4);
  });

  it("caps the backoff delay at 60 seconds regardless of attempt number", () => {
    // A very high attempt number should not exceed 60_000ms (+ 20% jitter = 72_000ms)
    const delay = calculateBackoffDelay(100, 1000);
    expect(delay).toBeLessThanOrEqual(60_000 * 1.2);
  });

  it("scales proportionally with backoffBaseMs", () => {
    expect(calculateBackoffDelay(0, 100)).toBeGreaterThanOrEqual(100);
    expect(calculateBackoffDelay(0, 500)).toBeGreaterThanOrEqual(500);
    expect(calculateBackoffDelay(0, 2000)).toBeGreaterThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe("withTimeout", () => {
  it("resolves with the function's value before the timeout", async () => {
    const result = await withTimeout(() => Promise.resolve("hello"), 5000);
    expect(result).toBe("hello");
  });

  it("rejects with a timeout error when the function is too slow", async () => {
    const slow = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500));

    await expect(withTimeout(slow, 20)).rejects.toThrow(
      /timed out after 20ms/
    );
  });

  it("rejects with the function's own error (not a timeout) when it fails fast", async () => {
    const failing = () => Promise.reject(new Error("original error"));
    await expect(withTimeout(failing, 5000)).rejects.toThrow("original error");
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  it("returns value with attempts=1 when the first call succeeds (zero retries)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn, {
      maxRetries: 3,
      backoffBaseMs: 1,
      timeoutMs: 5000,
    });

    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries the exact configured number of times before failing", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(
      withRetry(fn, { maxRetries: 2, backoffBaseMs: 1, timeoutMs: 5000 })
    ).rejects.toThrow("always fails");

    // 1 initial attempt + 2 retries = 3 total
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws RetryExhaustedError with the correct attempt count on failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    try {
      await withRetry(fn, { maxRetries: 2, backoffBaseMs: 1, timeoutMs: 5000 });
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      expect((err as RetryExhaustedError).attempts).toBe(3);
    }
  });

  it("succeeds on a later attempt after a transient failure", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, {
      maxRetries: 2,
      backoffBaseMs: 1,
      timeoutMs: 5000,
    });

    expect(result.value).toBe("recovered");
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("timeout triggers the retry sequence", async () => {
    // Each call sleeps 500ms – far longer than the 20ms timeout
    const fn = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500))
    );

    await expect(
      withRetry(fn, { maxRetries: 2, backoffBaseMs: 1, timeoutMs: 20 })
    ).rejects.toThrow(/timed out/);

    // Should have been attempted 3 times (1 initial + 2 retries)
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("uses DEFAULT_RETRY_OPTIONS when no options are supplied", () => {
    expect(DEFAULT_RETRY_OPTIONS.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_OPTIONS.timeoutMs).toBe(60_000);
    expect(DEFAULT_RETRY_OPTIONS.backoffBaseMs).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
// runAgent with resilience config
// ---------------------------------------------------------------------------

describe("runAgent resilience", () => {
  const baseAgent: Agent = {
    name: "Resilient Agent",
    taskDescription: "Do a task",
  };

  it("includes attempts=1 in the result when the first call succeeds", async () => {
    const client: GeminiClient = {
      generateText: vi.fn().mockResolvedValue("response"),
    } as unknown as GeminiClient;

    const result = await runAgent(
      { ...baseAgent, maxRetries: 0, backoffBaseMs: 1 },
      client
    );

    expect(result.status).toBe("success");
    expect(result.attempts).toBe(1);
    expect(client.generateText).toHaveBeenCalledTimes(1);
  });

  it("retries and marks permanent failure after exhausting maxRetries", async () => {
    const client: GeminiClient = {
      generateText: vi.fn().mockRejectedValue(new Error("API down")),
    } as unknown as GeminiClient;

    const result = await runAgent(
      { ...baseAgent, maxRetries: 2, backoffBaseMs: 1 },
      client
    );

    expect(result.status).toBe("failure");
    expect(result.error).toBe("API down");
    // 1 initial attempt + 2 retries = 3 total
    expect(result.attempts).toBe(3);
    expect(client.generateText).toHaveBeenCalledTimes(3);
  });

  it("records the correct attempt count on a retry-then-success path", async () => {
    const client: GeminiClient = {
      generateText: vi
        .fn()
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValue("ok"),
    } as unknown as GeminiClient;

    const result = await runAgent(
      { ...baseAgent, maxRetries: 2, backoffBaseMs: 1 },
      client
    );

    expect(result.status).toBe("success");
    expect(result.attempts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scheduler: next scheduled run proceeds after a permanent failure
// ---------------------------------------------------------------------------

describe("Scheduler: resilience with persistent failure", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await runMigrations(db);
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  it("next scheduled tick fires even when the previous run permanently failed", async () => {
    const client: GeminiClient = {
      generateText: vi.fn().mockRejectedValue(new Error("permanent error")),
    } as unknown as GeminiClient;

    await insertAgent(db, {
      name: "Failing Agent",
      taskDescription: "Always fails",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      backoffBaseMs: 1,
    });

    const scheduler = new Scheduler(db, client);

    // First tick – will fail
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    // Second tick at the next minute – should still attempt to run
    await scheduler.tick(new Date("2026-01-01T10:02:00.000Z"));

    // Each tick triggers one call (maxRetries=0 → no retries)
    expect(client.generateText).toHaveBeenCalledTimes(2);
  });

  it("persists attempt count in execution record", async () => {
    const client: GeminiClient = {
      generateText: vi
        .fn()
        .mockRejectedValueOnce(new Error("retry me"))
        .mockResolvedValue("ok"),
    } as unknown as GeminiClient;

    const stored = await insertAgent(db, {
      name: "Retry Agent",
      taskDescription: "Will succeed on second attempt",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 1,
      backoffBaseMs: 1,
    });

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    const executions = await listExecutionsByAgentId(db, stored.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe("success");
    expect(executions[0].attempts).toBe(2);
  });
});
