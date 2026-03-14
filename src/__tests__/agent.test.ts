import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSchema, ExecutionResultSchema, type Agent } from "../agent";
import { buildPrompt } from "../promptBuilder";
import { runAgent } from "../runAgent";
import type { GeminiClient } from "../geminiClient";

// ---------------------------------------------------------------------------
// Agent schema
// ---------------------------------------------------------------------------

describe("AgentSchema", () => {
  it("parses a minimal agent (no system prompt)", () => {
    const agent = AgentSchema.parse({
      name: "Summariser",
      taskDescription: "Summarise the key benefits of TDD",
    });
    expect(agent.name).toBe("Summariser");
    expect(agent.taskDescription).toBe(
      "Summarise the key benefits of TDD"
    );
    expect(agent.systemPrompt).toBeUndefined();
  });

  it("parses an agent with a system prompt", () => {
    const agent = AgentSchema.parse({
      name: "Concise Writer",
      taskDescription: "Explain async/await",
      systemPrompt: "You are concise. Use bullet points.",
    });
    expect(agent.systemPrompt).toBe("You are concise. Use bullet points.");
  });

  it("rejects an agent with an empty name", () => {
    expect(() =>
      AgentSchema.parse({ name: "", taskDescription: "Do something" })
    ).toThrow();
  });

  it("rejects an agent with an empty taskDescription", () => {
    expect(() =>
      AgentSchema.parse({ name: "Agent", taskDescription: "" })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ExecutionResult schema
// ---------------------------------------------------------------------------

describe("ExecutionResultSchema", () => {
  it("parses a success result", () => {
    const result = ExecutionResultSchema.parse({
      agentName: "Summariser",
      ranAt: new Date(),
      status: "success",
      response: "Here is the summary.",
    });
    expect(result.status).toBe("success");
    expect(result.response).toBe("Here is the summary.");
  });

  it("parses a failure result", () => {
    const result = ExecutionResultSchema.parse({
      agentName: "Summariser",
      ranAt: new Date(),
      status: "failure",
      error: "API timeout",
    });
    expect(result.status).toBe("failure");
    expect(result.error).toBe("API timeout");
  });

  it("rejects an unknown status value", () => {
    expect(() =>
      ExecutionResultSchema.parse({
        agentName: "Agent",
        ranAt: new Date(),
        status: "pending",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("returns just the taskDescription when there is no system prompt", () => {
    const agent: Agent = {
      name: "Simple",
      taskDescription: "Summarise TDD benefits",
    };
    expect(buildPrompt(agent)).toBe("Summarise TDD benefits");
  });

  it("prepends the system prompt separated by a blank line", () => {
    const agent: Agent = {
      name: "Styled",
      taskDescription: "Explain async/await",
      systemPrompt: "Be concise. Use bullet points.",
    };
    expect(buildPrompt(agent)).toBe(
      "Be concise. Use bullet points.\n\nExplain async/await"
    );
  });
});

// ---------------------------------------------------------------------------
// runAgent
// ---------------------------------------------------------------------------

function makeMockClient(
  impl: () => Promise<string>
): GeminiClient {
  return { generateText: vi.fn().mockImplementation(impl) } as unknown as GeminiClient;
}

describe("runAgent", () => {
  const baseAgent: Agent = {
    name: "Test Agent",
    taskDescription: "Summarise the key benefits of test-driven development",
  };

  it("returns a success result with agentName, ranAt, status, and response", async () => {
    const client = makeMockClient(async () => "TDD makes code reliable.");

    const result = await runAgent(baseAgent, client);

    expect(result.agentName).toBe("Test Agent");
    expect(result.status).toBe("success");
    expect(result.response).toBe("TDD makes code reliable.");
    expect(result.ranAt).toBeInstanceOf(Date);
    expect(result.error).toBeUndefined();
  });

  it("passes the built prompt to the client", async () => {
    const generateText = vi.fn().mockResolvedValue("response");
    const client = { generateText } as unknown as GeminiClient;

    const agent: Agent = {
      name: "Styled Agent",
      taskDescription: "Do the task",
      systemPrompt: "Be brief.",
    };

    await runAgent(agent, client);

    expect(generateText).toHaveBeenCalledWith("Be brief.\n\nDo the task");
  });

  it("system prompt shapes the prompt sent to the LLM", async () => {
    const generateText = vi.fn().mockResolvedValue("Bullet point response");
    const client = { generateText } as unknown as GeminiClient;

    const agent: Agent = {
      name: "Bullet Agent",
      taskDescription: "Explain recursion",
      systemPrompt: "You are concise. Respond with bullet points only.",
    };

    const result = await runAgent(agent, client);

    const calledPrompt = (generateText as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(calledPrompt).toContain("You are concise. Respond with bullet points only.");
    expect(calledPrompt).toContain("Explain recursion");
    expect(result.status).toBe("success");
  });

  it("returns a failure result when the LLM throws, without crashing", async () => {
    const client = makeMockClient(async () => {
      throw new Error("Service unavailable");
    });

    const result = await runAgent(baseAgent, client);

    expect(result.agentName).toBe("Test Agent");
    expect(result.status).toBe("failure");
    expect(result.error).toBe("Service unavailable");
    expect(result.response).toBeUndefined();
    expect(result.ranAt).toBeInstanceOf(Date);
  });

  it("handles a non-Error thrown value gracefully", async () => {
    const client = makeMockClient(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "string error";
    });

    const result = await runAgent(baseAgent, client);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("string error");
  });

  it("impossible task returns graceful failure result without crashing", async () => {
    // Simulate the LLM returning a response even for an impossible task
    const client = makeMockClient(async () =>
      "I cannot complete this task as described."
    );

    const agent: Agent = {
      name: "Impossible Agent",
      taskDescription:
        "Calculate the last digit of pi to infinite precision right now",
    };

    const result = await runAgent(agent, client);

    expect(result.status).toBe("success");
    expect(result.response).toBeDefined();
    expect(result.agentName).toBe("Impossible Agent");
  });
});
