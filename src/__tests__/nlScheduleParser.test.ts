import { describe, it, expect, vi } from "vitest";
import {
  parseNaturalLanguageSchedule,
  isParsedSchedule,
  formatScheduleConfirmation,
} from "../nlScheduleParser";
import type { GeminiClient } from "../geminiClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClient(jsonResponse: object): GeminiClient {
  return {
    generateText: vi.fn().mockResolvedValue(JSON.stringify(jsonResponse)),
  } as unknown as GeminiClient;
}

function failingClient(message = "API error"): GeminiClient {
  return {
    generateText: vi.fn().mockRejectedValue(new Error(message)),
  } as unknown as GeminiClient;
}

// ---------------------------------------------------------------------------
// parseNaturalLanguageSchedule – success cases
// ---------------------------------------------------------------------------

describe("parseNaturalLanguageSchedule – success cases", () => {
  it("parses 'every day at 7am' to '0 7 * * *'", async () => {
    const client = mockClient({ cron: "0 7 * * *", description: "Every day at 7:00 AM" });
    const result = await parseNaturalLanguageSchedule("every day at 7am", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      expect(result.cron).toBe("0 7 * * *");
      expect(result.description).toBeTruthy();
    }
  });

  it("parses 'every weekday at 9am' to '0 9 * * 1-5'", async () => {
    const client = mockClient({ cron: "0 9 * * 1-5", description: "Every weekday at 9:00 AM" });
    const result = await parseNaturalLanguageSchedule("every weekday at 9am", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      expect(result.cron).toBe("0 9 * * 1-5");
    }
  });

  it("parses 'every Monday at 8am' to '0 8 * * 1'", async () => {
    const client = mockClient({ cron: "0 8 * * 1", description: "Every Monday at 8:00 AM" });
    const result = await parseNaturalLanguageSchedule("every Monday at 8am", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      expect(result.cron).toBe("0 8 * * 1");
    }
  });

  it("parses 'every 3 hours' to '0 */3 * * *'", async () => {
    const client = mockClient({ cron: "0 */3 * * *", description: "Every 3 hours" });
    const result = await parseNaturalLanguageSchedule("every 3 hours", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      expect(result.cron).toBe("0 */3 * * *");
    }
  });

  it("parses 'twice a day' to a valid five-field cron schedule", async () => {
    const client = mockClient({
      cron: "0 9,18 * * *",
      description: "Twice a day at 9:00 AM and 6:00 PM",
    });
    const result = await parseNaturalLanguageSchedule("twice a day", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      // Validate it is a valid five-field cron
      const fields = result.cron.trim().split(/\s+/);
      expect(fields).toHaveLength(5);
      expect(result.description).toBeTruthy();
    }
  });

  it("includes optional notes when the LLM provides them", async () => {
    const client = mockClient({
      cron: "0 9,18 * * *",
      description: "Twice a day",
      notes: "Times chosen as common working hours",
    });
    const result = await parseNaturalLanguageSchedule("twice a day", client);
    expect(isParsedSchedule(result)).toBe(true);
    if (isParsedSchedule(result)) {
      expect(result.notes).toBe("Times chosen as common working hours");
    }
  });
});

// ---------------------------------------------------------------------------
// parseNaturalLanguageSchedule – error / ambiguous cases
// ---------------------------------------------------------------------------

describe("parseNaturalLanguageSchedule – error cases", () => {
  it("returns a clear error for ambiguous input ('sometimes in the morning')", async () => {
    const client = mockClient({
      error:
        "The schedule 'sometimes in the morning' is ambiguous – please specify a time, e.g. 'every day at 9am'.",
    });
    const result = await parseNaturalLanguageSchedule("sometimes in the morning", client);
    expect(isParsedSchedule(result)).toBe(false);
    if (!isParsedSchedule(result)) {
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("returns an error immediately for empty input without calling the LLM", async () => {
    const client = mockClient({});
    const result = await parseNaturalLanguageSchedule("  ", client);
    expect(isParsedSchedule(result)).toBe(false);
    expect((client.generateText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns an error when the LLM call throws", async () => {
    const client = failingClient("Network timeout");
    const result = await parseNaturalLanguageSchedule("every day at 7am", client);
    expect(isParsedSchedule(result)).toBe(false);
    if (!isParsedSchedule(result)) {
      expect(result.error).toContain("Failed to parse schedule");
      expect(result.error).toContain("Network timeout");
    }
  });

  it("returns an error when the LLM returns an invalid cron expression", async () => {
    const client = mockClient({ cron: "not-a-cron", description: "Something" });
    const result = await parseNaturalLanguageSchedule("every day at 7am", client);
    expect(isParsedSchedule(result)).toBe(false);
    if (!isParsedSchedule(result)) {
      expect(result.error).toContain("not-a-cron");
    }
  });

  it("returns an error when the LLM response is not parseable JSON", async () => {
    const client: GeminiClient = {
      generateText: vi.fn().mockResolvedValue("Sorry, I cannot parse that."),
    } as unknown as GeminiClient;
    const result = await parseNaturalLanguageSchedule("blah blah", client);
    expect(isParsedSchedule(result)).toBe(false);
    if (!isParsedSchedule(result)) {
      expect(typeof result.error).toBe("string");
    }
  });

  it("returns an error when the LLM response has missing required fields", async () => {
    // Returns a JSON object that is neither a valid success nor error shape
    const client: GeminiClient = {
      generateText: vi.fn().mockResolvedValue(JSON.stringify({ foo: "bar" })),
    } as unknown as GeminiClient;
    const result = await parseNaturalLanguageSchedule("every day at 7am", client);
    expect(isParsedSchedule(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatScheduleConfirmation
// ---------------------------------------------------------------------------

describe("formatScheduleConfirmation", () => {
  it("includes the cron expression and description", () => {
    const msg = formatScheduleConfirmation({
      cron: "0 7 * * *",
      description: "Every day at 7:00 AM",
    });
    expect(msg).toContain("0 7 * * *");
    expect(msg).toContain("Every day at 7:00 AM");
  });

  it("includes notes when present", () => {
    const msg = formatScheduleConfirmation({
      cron: "0 9,18 * * *",
      description: "Twice a day",
      notes: "Times chosen as common working hours",
    });
    expect(msg).toContain("Times chosen as common working hours");
  });

  it("does not include a note line when notes are absent", () => {
    const msg = formatScheduleConfirmation({
      cron: "0 8 * * 1",
      description: "Every Monday at 8:00 AM",
    });
    expect(msg).not.toContain("Note:");
  });
});

// ---------------------------------------------------------------------------
// isParsedSchedule type guard
// ---------------------------------------------------------------------------

describe("isParsedSchedule", () => {
  it("returns true for a ParsedSchedule", () => {
    expect(isParsedSchedule({ cron: "0 7 * * *", description: "desc" })).toBe(true);
  });

  it("returns false for a ParseScheduleError", () => {
    expect(isParsedSchedule({ error: "some error" })).toBe(false);
  });
});
