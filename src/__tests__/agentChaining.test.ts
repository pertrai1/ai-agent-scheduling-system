import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSchema, type Agent } from "../agent";
import { buildPrompt } from "../promptBuilder";
import { runAgent } from "../runAgent";
import { openDatabase, closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import {
  insertAgent,
  listExecutionsByAgentId,
  fetchAgentByName,
} from "../agentRepository";
import { Scheduler } from "../scheduler";
import type { GeminiClient } from "../geminiClient";
import type sqlite3 from "sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openTestDb(): Promise<sqlite3.Database> {
  const db = openDatabase(":memory:");
  await runMigrations(db);
  return db;
}

function makeMockClient(response = "upstream result"): GeminiClient {
  return {
    generateText: vi.fn().mockResolvedValue(response),
    generateWithTools: vi.fn().mockResolvedValue(response),
  } as unknown as GeminiClient;
}

// ---------------------------------------------------------------------------
// AgentSchema – chainTo field
// ---------------------------------------------------------------------------

describe("AgentSchema – chainTo field", () => {
  it("accepts an agent with a chainTo name", () => {
    const agent = AgentSchema.parse({
      name: "Upstream",
      taskDescription: "Do step one",
      chainTo: "Downstream",
    });
    expect(agent.chainTo).toBe("Downstream");
  });

  it("accepts an agent without chainTo (defaults to undefined)", () => {
    const agent = AgentSchema.parse({
      name: "Solo",
      taskDescription: "Do something standalone",
    });
    expect(agent.chainTo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildPrompt – previousOutput injection
// ---------------------------------------------------------------------------

describe("buildPrompt – previousOutput", () => {
  const agent: Agent = {
    name: "Summariser",
    taskDescription: "Summarise the content above.",
  };

  it("returns just the taskDescription when no previousOutput is given", () => {
    expect(buildPrompt(agent)).toBe("Summarise the content above.");
  });

  it("prepends previousOutput to the prompt", () => {
    const prompt = buildPrompt(agent, "raw upstream data");
    expect(prompt).toContain("Previous agent output:\nraw upstream data");
    expect(prompt).toContain("Summarise the content above.");
  });

  it("preserves systemPrompt when previousOutput is also present", () => {
    const agentWithSystem: Agent = {
      name: "Analyst",
      taskDescription: "Analyse the content.",
      systemPrompt: "Be precise.",
    };
    const prompt = buildPrompt(agentWithSystem, "some data");
    expect(prompt).toContain("Be precise.");
    expect(prompt).toContain("Analyse the content.");
    expect(prompt).toContain("Previous agent output:\nsome data");
  });

  it("orders output as: previousOutput first, then system+task", () => {
    const agentWithSystem: Agent = {
      name: "Writer",
      taskDescription: "Write a summary.",
      systemPrompt: "Be concise.",
    };
    const prompt = buildPrompt(agentWithSystem, "prior data");
    const outputIdx = prompt.indexOf("Previous agent output:");
    const systemIdx = prompt.indexOf("Be concise.");
    expect(outputIdx).toBeLessThan(systemIdx);
  });
});

// ---------------------------------------------------------------------------
// runAgent – previousOutput parameter
// ---------------------------------------------------------------------------

describe("runAgent – previousOutput parameter", () => {
  it("passes previousOutput into the prompt sent to the LLM", async () => {
    const agent: Agent = {
      name: "Processor",
      taskDescription: "Process the upstream data.",
      maxRetries: 0,
    };

    let capturedPrompt: string | undefined;
    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async (p: string) => {
        capturedPrompt = p;
        return "processed";
      }),
      generateWithTools: vi.fn(),
    } as unknown as GeminiClient;

    await runAgent(agent, client, undefined, "upstream output here");

    expect(capturedPrompt).toContain("Previous agent output:\nupstream output here");
    expect(capturedPrompt).toContain("Process the upstream data.");
  });

  it("succeeds without previousOutput (normal run)", async () => {
    const agent: Agent = {
      name: "Normal",
      taskDescription: "Do something.",
      maxRetries: 0,
    };
    const client = makeMockClient("result");
    const result = await runAgent(agent, client);
    expect(result.status).toBe("success");
    expect(result.response).toBe("result");
  });
});

// ---------------------------------------------------------------------------
// Scheduler – agent chaining integration
// ---------------------------------------------------------------------------

describe("Scheduler – agent chaining", () => {
  let db: sqlite3.Database;

  beforeEach(async () => {
    db = await openTestDb();
  });

  it("runs the chained agent after the upstream agent succeeds", async () => {
    const upstream = await insertAgent(db, {
      name: "Upstream Agent",
      taskDescription: "Produce some data.",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      chainTo: "Downstream Agent",
    });
    const downstream = await insertAgent(db, {
      name: "Downstream Agent",
      taskDescription: "Summarise the upstream output.",
      enabled: true,
      maxRetries: 0,
    });

    const callOrder: string[] = [];
    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt.includes("Produce some data")) {
          callOrder.push("upstream");
          return "upstream result";
        }
        callOrder.push("downstream");
        return "downstream result";
      }),
      generateWithTools: vi.fn(),
    } as unknown as GeminiClient;

    const scheduler = new Scheduler(db, client);
    const now = new Date("2026-01-01T10:01:00.000Z");
    await scheduler.tick(now);

    expect(callOrder).toEqual(["upstream", "downstream"]);

    // Both agents should have execution records
    const upstreamExecs = await listExecutionsByAgentId(db, upstream.id);
    const downstreamExecs = await listExecutionsByAgentId(db, downstream.id);
    expect(upstreamExecs).toHaveLength(1);
    expect(downstreamExecs).toHaveLength(1);
    expect(upstreamExecs[0].status).toBe("success");
    expect(downstreamExecs[0].status).toBe("success");

    await closeDatabase(db);
  });

  it("passes upstream output as previousOutput to the downstream agent", async () => {
    await insertAgent(db, {
      name: "Source",
      taskDescription: "Generate a report.",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      chainTo: "Consumer",
    });
    await insertAgent(db, {
      name: "Consumer",
      taskDescription: "Summarise the report.",
      enabled: true,
      maxRetries: 0,
    });

    let downstreamPrompt: string | undefined;
    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt.includes("Generate a report")) {
          return "report content";
        }
        downstreamPrompt = prompt;
        return "summary";
      }),
      generateWithTools: vi.fn(),
    } as unknown as GeminiClient;

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    expect(downstreamPrompt).toContain("Previous agent output:\nreport content");

    await closeDatabase(db);
  });

  it("does not run the chained agent when the upstream agent fails", async () => {
    await insertAgent(db, {
      name: "Failing Source",
      taskDescription: "This will fail.",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      chainTo: "Should Not Run",
    });
    await insertAgent(db, {
      name: "Should Not Run",
      taskDescription: "This should not be called.",
      enabled: true,
      maxRetries: 0,
    });

    const client: GeminiClient = {
      generateText: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt.includes("This will fail")) {
          throw new Error("upstream error");
        }
        throw new Error("downstream should not be called");
      }),
      generateWithTools: vi.fn(),
    } as unknown as GeminiClient;

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    // generateText should only be called once (for the upstream failing agent)
    expect(client.generateText).toHaveBeenCalledTimes(1);

    await closeDatabase(db);
  });

  it("warns and stops when chained agent is not found", async () => {
    await insertAgent(db, {
      name: "Agent A",
      taskDescription: "Step one.",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      chainTo: "Nonexistent Agent",
    });

    const client = makeMockClient("output");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    // The upstream should still run successfully
    expect(client.generateText).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
    await closeDatabase(db);
  });

  it("enforces maximum chain depth to prevent infinite loops", async () => {
    // Create a circular chain: A -> B -> A (cycle)
    await insertAgent(db, {
      name: "Cyclic A",
      taskDescription: "Cycle step A.",
      cronExpression: "* * * * *",
      enabled: true,
      maxRetries: 0,
      chainTo: "Cyclic B",
    });
    await insertAgent(db, {
      name: "Cyclic B",
      taskDescription: "Cycle step B.",
      enabled: true,
      maxRetries: 0,
      chainTo: "Cyclic A",
    });

    const client = makeMockClient("cyclic output");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const scheduler = new Scheduler(db, client);
    await scheduler.tick(new Date("2026-01-01T10:01:00.000Z"));

    // The chain should be capped at MAX_CHAIN_DEPTH (10); with A->B->A->B...
    // each round alternates, so we expect at most MAX_CHAIN_DEPTH + 1 = 11 calls
    expect(client.generateText).toHaveBeenCalled();
    const callCount = (client.generateText as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(11);

    warnSpy.mockRestore();
    await closeDatabase(db);
  });
});
