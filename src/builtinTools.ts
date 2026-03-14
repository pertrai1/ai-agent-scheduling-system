import { ToolRegistry, type ToolDefinition, type ToolHandler } from "./toolRegistry";

// ---------------------------------------------------------------------------
// current_time tool
// ---------------------------------------------------------------------------

export const CURRENT_TIME_TOOL: ToolDefinition = {
  name: "current_time",
  description: "Returns the current date and time in ISO 8601 format (UTC).",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const currentTimeHandler: ToolHandler = async (_args) => {
  return new Date().toISOString();
};

// ---------------------------------------------------------------------------
// http_get tool
// ---------------------------------------------------------------------------

export const HTTP_GET_TOOL: ToolDefinition = {
  name: "http_get",
  description:
    "Performs an HTTP GET request to the given URL and returns the response body as text. The response is truncated to 10,000 characters.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch (must be http:// or https://).",
      },
    },
    required: ["url"],
  },
};

/** Maximum number of characters returned from an http_get response. */
export const HTTP_GET_MAX_CHARS = 10_000;

export const httpGetHandler: ToolHandler = async (args) => {
  const url = args.url;
  if (!url || typeof url !== "string") {
    throw new Error("http_get requires a string `url` argument");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for URL: ${url}`
    );
  }
  const text = await response.text();
  return text.slice(0, HTTP_GET_MAX_CHARS);
};

// ---------------------------------------------------------------------------
// Default registry factory
// ---------------------------------------------------------------------------

/**
 * Creates a new ToolRegistry pre-populated with all built-in tools:
 * - `current_time` – returns the current UTC timestamp
 * - `http_get`     – fetches a URL and returns the response body
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(CURRENT_TIME_TOOL, currentTimeHandler);
  registry.register(HTTP_GET_TOOL, httpGetHandler);
  return registry;
}
