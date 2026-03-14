import { ToolRegistry, type ToolDefinition, type ToolHandler } from "./toolRegistry";
import {
  fetchRssFeed,
  fetchJsonApi,
  fetchWebpageText,
  RSS_FEED_MAX_ITEMS,
} from "./dataFetcher";

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
// fetch_rss tool
// ---------------------------------------------------------------------------

export const FETCH_RSS_TOOL: ToolDefinition = {
  name: "fetch_rss",
  description:
    "Fetches an RSS or Atom feed from the given URL and returns the parsed feed items as a JSON string. Each item includes title, link, description, pubDate, and guid.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL of the RSS or Atom feed to fetch.",
      },
      max_items: {
        type: "number",
        description: `Maximum number of feed items to return (default: ${RSS_FEED_MAX_ITEMS}).`,
      },
    },
    required: ["url"],
  },
};

export const fetchRssHandler: ToolHandler = async (args) => {
  const url = args.url;
  if (!url || typeof url !== "string") {
    throw new Error("fetch_rss requires a string `url` argument");
  }
  const maxItems =
    typeof args.max_items === "number" ? Math.floor(args.max_items) : undefined;
  const feed = await fetchRssFeed(url, maxItems);
  return JSON.stringify(feed, null, 2);
};

// ---------------------------------------------------------------------------
// fetch_json tool
// ---------------------------------------------------------------------------

export const FETCH_JSON_TOOL: ToolDefinition = {
  name: "fetch_json",
  description:
    "Fetches a JSON API endpoint and returns the parsed response as a formatted JSON string (truncated to 10,000 characters). Supports optional HTTP request headers.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The API endpoint URL to fetch.",
      },
      headers: {
        type: "string",
        description:
          'Optional JSON object string of HTTP headers to include in the request, e.g. \'{"Authorization": "Bearer token"}\'.',
      },
    },
    required: ["url"],
  },
};

export const fetchJsonHandler: ToolHandler = async (args) => {
  const url = args.url;
  if (!url || typeof url !== "string") {
    throw new Error("fetch_json requires a string `url` argument");
  }
  let headers: Record<string, string> | undefined;
  if (args.headers !== undefined) {
    if (typeof args.headers !== "string") {
      throw new Error("fetch_json: `headers` must be a JSON string if provided");
    }
    const parsed: unknown = JSON.parse(args.headers);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "fetch_json: `headers` must be a JSON string representing an object (e.g. '{\"Authorization\":\"Bearer token\"}')"
    );
    }
    headers = parsed as Record<string, string>;
  }
  return fetchJsonApi(url, headers);
};

// ---------------------------------------------------------------------------
// fetch_webpage_text tool
// ---------------------------------------------------------------------------

export const FETCH_WEBPAGE_TEXT_TOOL: ToolDefinition = {
  name: "fetch_webpage_text",
  description:
    "Fetches a web page from the given URL, strips all HTML tags, and returns the readable plain text (truncated to 10,000 characters).",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL of the web page to fetch.",
      },
    },
    required: ["url"],
  },
};

export const fetchWebpageTextHandler: ToolHandler = async (args) => {
  const url = args.url;
  if (!url || typeof url !== "string") {
    throw new Error("fetch_webpage_text requires a string `url` argument");
  }
  return fetchWebpageText(url);
};

// ---------------------------------------------------------------------------
// Default registry factory
// ---------------------------------------------------------------------------

/**
 * Creates a new ToolRegistry pre-populated with all built-in tools:
 * - `current_time`        – returns the current UTC timestamp
 * - `http_get`            – fetches a URL and returns the response body
 * - `fetch_rss`           – fetches and parses an RSS or Atom feed
 * - `fetch_json`          – fetches a JSON API endpoint
 * - `fetch_webpage_text`  – fetches a web page and returns plain text
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(CURRENT_TIME_TOOL, currentTimeHandler);
  registry.register(HTTP_GET_TOOL, httpGetHandler);
  registry.register(FETCH_RSS_TOOL, fetchRssHandler);
  registry.register(FETCH_JSON_TOOL, fetchJsonHandler);
  registry.register(FETCH_WEBPAGE_TEXT_TOOL, fetchWebpageTextHandler);
  return registry;
}
