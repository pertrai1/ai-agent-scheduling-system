import {
  GoogleGenerativeAI,
  SchemaType,
  type GenerativeModel,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type Part,
  type Schema,
} from "@google/generative-ai";
import type { ToolDefinition } from "./toolRegistry";

export interface GeminiClientOptions {
  apiKey: string;
  model?: string;
}

/** Maximum number of tool-call rounds per generateWithTools call. */
const MAX_TOOL_ROUNDS = 10;

export class GeminiClient {
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;
  private model: GenerativeModel;

  constructor(options: GeminiClientOptions) {
    this.genAI = new GoogleGenerativeAI(options.apiKey);
    this.modelName = options.model ?? "gemini-1.5-flash";
    this.model = this.genAI.getGenerativeModel({ model: this.modelName });
  }

  async generateText(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    const response = result.response;
    return response.text();
  }

  /**
   * Sends a prompt to Gemini with a set of tool definitions.  The model may
   * invoke tools zero or more times; each invocation is executed via
   * `toolExecutor` and the result is sent back until the model produces a
   * final text response (or the round limit is reached).
   */
  async generateWithTools(
    prompt: string,
    toolDefinitions: ToolDefinition[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>
  ): Promise<string> {
    const functionDeclarations: FunctionDeclaration[] = toolDefinitions.map(
      (tool) => {
        const properties: Record<string, Schema> = Object.fromEntries(
          Object.entries(tool.parameters.properties ?? {}).map(([key, prop]) => [
            key,
            { type: prop.type as SchemaType, description: prop.description } as Schema,
          ])
        );
        const parameters: FunctionDeclarationSchema = {
          type: SchemaType.OBJECT,
          properties,
          required: tool.parameters.required,
        };
        return {
          name: tool.name,
          description: tool.description,
          parameters,
        };
      }
    );

    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      tools: [{ functionDeclarations }],
    });

    const chat = model.startChat();
    let result = await chat.sendMessage(prompt);

    let rounds = 0;
    while (rounds < MAX_TOOL_ROUNDS) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      rounds++;
      const toolResponseParts: Part[] = await Promise.all(
        calls.map(async (call) => {
          const toolResult = await toolExecutor(
            call.name,
            call.args as Record<string, unknown>
          );
          return {
            functionResponse: {
              name: call.name,
              response: { result: toolResult },
            },
          } satisfies Part;
        })
      );

      result = await chat.sendMessage(toolResponseParts);
    }

    return result.response.text();
  }
}
