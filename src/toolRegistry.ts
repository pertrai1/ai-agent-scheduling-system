import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool definition schemas
// ---------------------------------------------------------------------------

export const ToolParameterPropertySchema = z.object({
  type: z.string(),
  description: z.string().optional(),
});

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  description: z.string().min(1, "Tool description is required"),
  parameters: z.object({
    type: z.literal("object"),
    description: z.string().optional(),
    properties: z.record(ToolParameterPropertySchema).optional(),
    required: z.array(z.string()).optional(),
  }),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

/** A tool handler receives the parsed arguments and returns a string result. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/** Registry that maps tool names to their definition and handler. */
export class ToolRegistry {
  private readonly tools = new Map<
    string,
    { definition: ToolDefinition; handler: ToolHandler }
  >();

  /**
   * Register a tool with its handler.
   * Validates the definition with Zod before storing.
   * Throws if a tool with the same name is already registered.
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    ToolDefinitionSchema.parse(definition);
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  /** Returns all registered tool definitions. */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Returns definitions for the specified tool names.
   * Unknown names are silently skipped.
   */
  getDefinitionsForNames(names: string[]): ToolDefinition[] {
    return names
      .map((name) => this.tools.get(name)?.definition)
      .filter((d): d is ToolDefinition => d !== undefined);
  }

  /**
   * Execute a registered tool by name with the given arguments.
   * Throws if the tool is not registered.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Tool not found: "${name}"`);
    }
    return entry.handler(args);
  }

  /** Returns true if a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Returns the number of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}
