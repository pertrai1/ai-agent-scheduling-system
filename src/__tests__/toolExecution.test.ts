import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ToolRegistry,
  ToolDefinitionSchema,
  type ToolDefinition,
} from "../toolRegistry";
import {
  CURRENT_TIME_TOOL,
  currentTimeHandler,
  HTTP_GET_TOOL,
  HTTP_GET_MAX_CHARS,
  httpGetHandler,
  createDefaultToolRegistry,
} from "../builtinTools";
import { AgentSchema, type Agent } from "../agent";
import { runAgent } from "../runAgent";
import type { GeminiClient } from "../geminiClient";

// ---------------------------------------------------------------------------
// ToolDefinitionSchema
// ---------------------------------------------------------------------------

describe("ToolDefinitionSchema", () => {
  it("parses a valid tool definition", () => {
    const def = ToolDefinitionSchema.parse({
      name: "my_tool",
      description: "Does something useful",
      parameters: { type: "object", properties: {}, required: [] },
    });
    expect(def.name).toBe("my_tool");
  });

  it("rejects a tool with an empty name", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "",
        description: "desc",
        parameters: { type: "object" },
      })
    ).toThrow();
  });

  it("rejects a tool with an empty description", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "tool",
        description: "",
        parameters: { type: "object" },
      })
    ).toThrow();
  });

  it("rejects a tool whose parameters type is not 'object'", () => {
    expect(() =>
      ToolDefinitionSchema.parse({
        name: "tool",
        description: "desc",
        parameters: { type: "string" },
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  const sampleDef: ToolDefinition = {
    name: "echo",
    description: "Returns the input unchanged",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Input text" } },
      required: ["text"],
    },
  };

  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers a tool and reflects it in size", () => {
    registry.register(sampleDef, async (args) => String(args.text));
    expect(registry.size).toBe(1);
    expect(registry.has("echo")).toBe(true);
  });

  it("throws when registering a duplicate tool name", () => {
    registry.register(sampleDef, async () => "first");
    expect(() => registry.register(sampleDef, async () => "second")).toThrow(
      /already registered/
    );
  });

  it("executes a registered tool", async () => {
    registry.register(sampleDef, async (args) => `echo:${String(args.text)}`);
    const result = await registry.execute("echo", { text: "hello" });
    expect(result).toBe("echo:hello");
  });

  it("throws when executing an unknown tool", async () => {
    await expect(registry.execute("unknown", {})).rejects.toThrow(
      /Tool not found/
    );
  });

  it("getDefinitions returns all registered definitions", () => {
    registry.register(sampleDef, async () => "");
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("echo");
  });

  it("getDefinitionsForNames returns only requested tools", () => {
    const other: ToolDefinition = {
      name: "other",
      description: "Other tool",
      parameters: { type: "object" },
    };
    registry.register(sampleDef, async () => "");
    registry.register(other, async () => "");

    const defs = registry.getDefinitionsForNames(["echo"]);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("echo");
  });

  it("getDefinitionsForNames silently skips unknown names", () => {
    registry.register(sampleDef, async () => "");
    const defs = registry.getDefinitionsForNames(["echo", "nonexistent"]);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("echo");
  });

  it("size is 0 for a new registry", () => {
    expect(registry.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

describe("currentTimeHandler", () => {
  it("returns a valid ISO 8601 timestamp", async () => {
    const result = await currentTimeHandler({});
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });
});

describe("httpGetHandler", () => {
  it("throws when url argument is missing", async () => {
    await expect(httpGetHandler({})).rejects.toThrow(/url/);
  });

  it("throws when url is not a string", async () => {
    await expect(httpGetHandler({ url: 42 })).rejects.toThrow(/url/);
  });

  it("truncates responses longer than HTTP_GET_MAX_CHARS", async () => {
    const longBody = "x".repeat(HTTP_GET_MAX_CHARS + 100);
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => longBody,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await httpGetHandler({ url: "http://example.com" });
    expect(result).toHaveLength(HTTP_GET_MAX_CHARS);

    vi.unstubAllGlobals();
  });

  it("throws on non-OK HTTP responses", async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not found",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    await expect(httpGetHandler({ url: "http://example.com/missing" })).rejects.toThrow(
      /404/
    );

    vi.unstubAllGlobals();
  });
});

describe("CURRENT_TIME_TOOL definition", () => {
  it("has correct name and parameters type", () => {
    expect(CURRENT_TIME_TOOL.name).toBe("current_time");
    expect(CURRENT_TIME_TOOL.parameters.type).toBe("object");
  });
});

describe("HTTP_GET_TOOL definition", () => {
  it("has correct name and requires url parameter", () => {
    expect(HTTP_GET_TOOL.name).toBe("http_get");
    expect(HTTP_GET_TOOL.parameters.required).toContain("url");
  });
});

describe("createDefaultToolRegistry", () => {
  it("returns a registry with current_time and http_get pre-registered", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.has("current_time")).toBe(true);
    expect(registry.has("http_get")).toBe(true);
    expect(registry.size).toBeGreaterThanOrEqual(2);
  });

  it("each call returns an independent registry instance", () => {
    const r1 = createDefaultToolRegistry();
    const r2 = createDefaultToolRegistry();
    expect(r1).not.toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// Agent schema with tools field
// ---------------------------------------------------------------------------

describe("AgentSchema with tools", () => {
  it("accepts an agent with a tools array", () => {
    const agent = AgentSchema.parse({
      name: "Tool Agent",
      taskDescription: "Fetch data and summarise",
      tools: ["http_get", "current_time"],
    });
    expect(agent.tools).toEqual(["http_get", "current_time"]);
  });

  it("accepts an agent without tools (defaults to undefined)", () => {
    const agent = AgentSchema.parse({
      name: "Plain Agent",
      taskDescription: "Summarise TDD",
    });
    expect(agent.tools).toBeUndefined();
  });

  it("accepts an agent with an empty tools array", () => {
    const agent = AgentSchema.parse({
      name: "Empty Tools Agent",
      taskDescription: "Do something",
      tools: [],
    });
    expect(agent.tools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runAgent with tools
// ---------------------------------------------------------------------------

function makeMockClient(opts: {
  generateText?: () => Promise<string>;
  generateWithTools?: (
    prompt: string,
    toolDefs: unknown,
    executor: unknown
  ) => Promise<string>;
}): GeminiClient {
  return {
    generateText: opts.generateText
      ? vi.fn().mockImplementation(opts.generateText)
      : vi.fn().mockResolvedValue("default response"),
    generateWithTools: opts.generateWithTools
      ? vi.fn().mockImplementation(opts.generateWithTools)
      : vi.fn().mockResolvedValue("tool response"),
  } as unknown as GeminiClient;
}

describe("runAgent – tool routing", () => {
  const baseAgent: Agent = {
    name: "Router Test",
    taskDescription: "Do something",
    maxRetries: 0,
  };

  it("calls generateText when agent has no tools", async () => {
    const client = makeMockClient({
      generateText: async () => "plain response",
    });

    const result = await runAgent(baseAgent, client);

    expect(result.status).toBe("success");
    expect(result.response).toBe("plain response");
    expect(client.generateText).toHaveBeenCalledOnce();
    expect(client.generateWithTools).not.toHaveBeenCalled();
  });

  it("calls generateText when toolRegistry is undefined even if agent has tools", async () => {
    const agent: Agent = { ...baseAgent, tools: ["http_get"] };
    const client = makeMockClient({
      generateText: async () => "plain fallback",
    });

    const result = await runAgent(agent, client, undefined);

    expect(result.status).toBe("success");
    expect(client.generateText).toHaveBeenCalledOnce();
    expect(client.generateWithTools).not.toHaveBeenCalled();
  });

  it("calls generateWithTools when agent has tools and a registry is provided", async () => {
    const agent: Agent = {
      ...baseAgent,
      tools: ["current_time"],
    };
    const client = makeMockClient({
      generateWithTools: async () => "tool-based response",
    });
    const registry = createDefaultToolRegistry();

    const result = await runAgent(agent, client, registry);

    expect(result.status).toBe("success");
    expect(result.response).toBe("tool-based response");
    expect(client.generateWithTools).toHaveBeenCalledOnce();
    expect(client.generateText).not.toHaveBeenCalled();
  });

  it("passes only the matching tool definitions to generateWithTools", async () => {
    const agent: Agent = {
      ...baseAgent,
      tools: ["current_time"], // only one of the two built-ins
    };
    let capturedDefs: unknown;
    const client = makeMockClient({
      generateWithTools: async (_prompt, defs) => {
        capturedDefs = defs;
        return "ok";
      },
    });
    const registry = createDefaultToolRegistry();

    await runAgent(agent, client, registry);

    expect(Array.isArray(capturedDefs)).toBe(true);
    expect((capturedDefs as unknown[]).length).toBe(1);
    expect((capturedDefs as Array<{ name: string }>)[0].name).toBe("current_time");
  });

  it("calls generateWithTools executor with tool calls and returns final response", async () => {
    const agent: Agent = {
      ...baseAgent,
      tools: ["current_time"],
    };

    let executorCalled = false;
    const client = makeMockClient({
      generateWithTools: async (_prompt, _defs, executor) => {
        // Simulate the model calling current_time
        const toolResult = await (executor as (name: string, args: Record<string, unknown>) => Promise<string>)(
          "current_time",
          {}
        );
        executorCalled = true;
        return `The time is: ${toolResult}`;
      },
    });
    const registry = createDefaultToolRegistry();

    const result = await runAgent(agent, client, registry);

    expect(executorCalled).toBe(true);
    expect(result.status).toBe("success");
    expect(result.response).toMatch(/The time is:/);
  });

  it("logs a warning when agent references tools not in the registry", async () => {
    const agent: Agent = {
      ...baseAgent,
      tools: ["nonexistent_tool"],
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = makeMockClient({
      generateText: async () => "fallback response",
    });
    const registry = createDefaultToolRegistry();

    const result = await runAgent(agent, client, registry);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent_tool")
    );
    // Falls back to plain text since no valid tools resolved
    expect(result.status).toBe("success");
    expect(client.generateText).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("returns a failure result when generateWithTools throws", async () => {
    const agent: Agent = {
      ...baseAgent,
      tools: ["http_get"],
      maxRetries: 0,
    };
    const client = makeMockClient({
      generateWithTools: async () => {
        throw new Error("tool execution failed");
      },
    });
    const registry = createDefaultToolRegistry();

    const result = await runAgent(agent, client, registry);

    expect(result.status).toBe("failure");
    expect(result.error).toContain("tool execution failed");
  });
});
