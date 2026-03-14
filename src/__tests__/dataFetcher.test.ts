import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  stripHtmlTags,
  parseRssFeed,
  fetchRssFeed,
  fetchJsonApi,
  fetchWebpageText,
  RSS_FEED_MAX_ITEMS,
  WEBPAGE_TEXT_MAX_CHARS,
  JSON_API_MAX_CHARS,
  type RssFeed,
} from "../dataFetcher";
import {
  FETCH_RSS_TOOL,
  FETCH_JSON_TOOL,
  FETCH_WEBPAGE_TEXT_TOOL,
  fetchRssHandler,
  fetchJsonHandler,
  fetchWebpageTextHandler,
  createDefaultToolRegistry,
} from "../builtinTools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(
  body: string,
  opts: { ok?: boolean; status?: number; statusText?: string } = {}
) {
  const { ok = true, status = 200, statusText = "OK" } = opts;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    text: async () => body,
    json: async () => JSON.parse(body),
  });
}

const RSS2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>A test RSS 2.0 feed</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <description>First post description</description>
      <pubDate>Mon, 01 Jan 2024 09:00:00 +0000</pubDate>
      <guid>https://example.com/first</guid>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <description><![CDATA[Second post <b>description</b>]]></description>
      <pubDate>Tue, 02 Jan 2024 09:00:00 +0000</pubDate>
      <guid>https://example.com/second</guid>
    </item>
  </channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Test Feed</title>
  <subtitle>A test Atom feed</subtitle>
  <link href="https://atom.example.com" rel="alternate"/>
  <entry>
    <title>Atom Entry One</title>
    <link href="https://atom.example.com/1" rel="alternate"/>
    <summary>Summary of entry one</summary>
    <published>2024-01-01T09:00:00Z</published>
    <id>https://atom.example.com/1</id>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link href="https://atom.example.com/2" rel="alternate"/>
    <content>Content of entry two</content>
    <updated>2024-01-02T09:00:00Z</updated>
    <id>https://atom.example.com/2</id>
  </entry>
</feed>`;

// ---------------------------------------------------------------------------
// stripHtmlTags
// ---------------------------------------------------------------------------

describe("stripHtmlTags", () => {
  it("removes simple HTML tags", () => {
    expect(stripHtmlTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("removes script and style blocks", () => {
    const html =
      '<script>alert("xss")</script><style>.a{}</style>Visible text';
    expect(stripHtmlTags(html)).toBe("Visible text");
  });

  it("decodes common HTML entities", () => {
    expect(stripHtmlTags("A &amp; B &lt;3 &gt; C &quot;ok&quot;")).toBe(
      'A & B <3 > C "ok"'
    );
  });

  it("decodes numeric character references", () => {
    expect(stripHtmlTags("&#65;&#66;&#67;")).toBe("ABC");
  });

  it("collapses multiple whitespace into a single space", () => {
    expect(stripHtmlTags("  lots   of   spaces  ")).toBe("lots of spaces");
  });

  it("removes HTML comments", () => {
    expect(stripHtmlTags("before <!-- a comment --> after")).toBe(
      "before after"
    );
  });

  it("returns an empty string for empty input", () => {
    expect(stripHtmlTags("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseRssFeed – RSS 2.0
// ---------------------------------------------------------------------------

describe("parseRssFeed – RSS 2.0", () => {
  let feed: RssFeed;

  beforeEach(() => {
    feed = parseRssFeed(RSS2_XML);
  });

  it("extracts the channel title", () => {
    expect(feed.title).toBe("Test Feed");
  });

  it("extracts the channel link", () => {
    expect(feed.link).toBe("https://example.com");
  });

  it("extracts the channel description", () => {
    expect(feed.description).toBe("A test RSS 2.0 feed");
  });

  it("returns the correct number of items", () => {
    expect(feed.items).toHaveLength(2);
  });

  it("extracts item title, link and pubDate", () => {
    const item = feed.items[0];
    expect(item.title).toBe("First Post");
    expect(item.link).toBe("https://example.com/first");
    expect(item.pubDate).toBe("Mon, 01 Jan 2024 09:00:00 +0000");
  });

  it("strips HTML tags from item description", () => {
    expect(feed.items[0].description).toBe("First post description");
  });

  it("strips CDATA wrapper and HTML from item description", () => {
    expect(feed.items[1].description).toBe("Second post description");
  });

  it("extracts item guid", () => {
    expect(feed.items[0].guid).toBe("https://example.com/first");
  });

  it("respects the maxItems limit", () => {
    const limited = parseRssFeed(RSS2_XML, 1);
    expect(limited.items).toHaveLength(1);
    expect(limited.items[0].title).toBe("First Post");
  });
});

// ---------------------------------------------------------------------------
// parseRssFeed – Atom 1.0
// ---------------------------------------------------------------------------

describe("parseRssFeed – Atom 1.0", () => {
  let feed: RssFeed;

  beforeEach(() => {
    feed = parseRssFeed(ATOM_XML);
  });

  it("extracts the feed title", () => {
    expect(feed.title).toBe("Atom Test Feed");
  });

  it("extracts the feed subtitle as description", () => {
    expect(feed.description).toBe("A test Atom feed");
  });

  it("extracts the feed alternate link href", () => {
    expect(feed.link).toBe("https://atom.example.com");
  });

  it("returns the correct number of entries", () => {
    expect(feed.items).toHaveLength(2);
  });

  it("extracts entry title and link", () => {
    expect(feed.items[0].title).toBe("Atom Entry One");
    expect(feed.items[0].link).toBe("https://atom.example.com/1");
  });

  it("uses <summary> as description", () => {
    expect(feed.items[0].description).toBe("Summary of entry one");
  });

  it("falls back to <content> when <summary> is absent", () => {
    expect(feed.items[1].description).toBe("Content of entry two");
  });

  it("extracts published date", () => {
    expect(feed.items[0].pubDate).toBe("2024-01-01T09:00:00Z");
  });

  it("falls back to updated when published is absent", () => {
    expect(feed.items[1].pubDate).toBe("2024-01-02T09:00:00Z");
  });

  it("extracts entry id as guid", () => {
    expect(feed.items[0].guid).toBe("https://atom.example.com/1");
  });

  it("respects the maxItems limit", () => {
    const limited = parseRssFeed(ATOM_XML, 1);
    expect(limited.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// fetchRssFeed
// ---------------------------------------------------------------------------

describe("fetchRssFeed", () => {
  it("fetches and parses an RSS 2.0 feed", async () => {
    vi.stubGlobal("fetch", makeFetchMock(RSS2_XML));
    const feed = await fetchRssFeed("https://example.com/feed.rss");
    expect(feed.title).toBe("Test Feed");
    expect(feed.items).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("fetches and parses an Atom feed", async () => {
    vi.stubGlobal("fetch", makeFetchMock(ATOM_XML));
    const feed = await fetchRssFeed("https://atom.example.com/feed");
    expect(feed.title).toBe("Atom Test Feed");
    expect(feed.items).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock("", { ok: false, status: 404, statusText: "Not Found" })
    );
    await expect(fetchRssFeed("https://example.com/bad")).rejects.toThrow(
      /404/
    );
    vi.unstubAllGlobals();
  });

  it("respects the maxItems argument", async () => {
    vi.stubGlobal("fetch", makeFetchMock(RSS2_XML));
    const feed = await fetchRssFeed("https://example.com/feed.rss", 1);
    expect(feed.items).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("uses RSS_FEED_MAX_ITEMS as default", () => {
    expect(RSS_FEED_MAX_ITEMS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fetchJsonApi
// ---------------------------------------------------------------------------

describe("fetchJsonApi", () => {
  const sampleJson = JSON.stringify({ name: "test", value: 42 });

  it("fetches and formats JSON from an API endpoint", async () => {
    vi.stubGlobal("fetch", makeFetchMock(sampleJson));
    const result = await fetchJsonApi("https://api.example.com/data");
    const parsed = JSON.parse(result) as { name: string; value: number };
    expect(parsed.name).toBe("test");
    expect(parsed.value).toBe(42);
    vi.unstubAllGlobals();
  });

  it("passes custom headers to fetch", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => sampleJson,
          json: async () => JSON.parse(sampleJson),
        });
      })
    );
    await fetchJsonApi("https://api.example.com/data", {
      Authorization: "Bearer token123",
    });
    // The headers may be a plain object or a Headers instance; check the value
    const rawHeaders = capturedInit?.headers;
    const authValue =
      rawHeaders instanceof Headers
        ? rawHeaders.get("Authorization")
        : (rawHeaders as Record<string, string> | undefined)?.Authorization;
    expect(authValue).toBe("Bearer token123");
    vi.unstubAllGlobals();
  });

  it("truncates responses longer than maxChars", async () => {
    const bigJson = JSON.stringify({ data: "x".repeat(20_000) });
    vi.stubGlobal("fetch", makeFetchMock(bigJson));
    const result = await fetchJsonApi(
      "https://api.example.com/big",
      undefined,
      100
    );
    expect(result.length).toBeLessThanOrEqual(100);
    vi.unstubAllGlobals();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock("Forbidden", { ok: false, status: 403, statusText: "Forbidden" })
    );
    await expect(fetchJsonApi("https://api.example.com/secret")).rejects.toThrow(
      /403/
    );
    vi.unstubAllGlobals();
  });

  it("uses JSON_API_MAX_CHARS as default", () => {
    expect(JSON_API_MAX_CHARS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// fetchWebpageText
// ---------------------------------------------------------------------------

describe("fetchWebpageText", () => {
  it("fetches and strips HTML from a web page", async () => {
    const html = "<html><body><h1>Hello</h1><p>World</p></body></html>";
    vi.stubGlobal("fetch", makeFetchMock(html));
    const result = await fetchWebpageText("https://example.com/page");
    expect(result).toBe("Hello World");
    vi.unstubAllGlobals();
  });

  it("removes script and style blocks", async () => {
    const html =
      '<script>evil()</script><style>body{}</style><p>Clean text</p>';
    vi.stubGlobal("fetch", makeFetchMock(html));
    const result = await fetchWebpageText("https://example.com");
    expect(result).toBe("Clean text");
    vi.unstubAllGlobals();
  });

  it("truncates the result to maxChars", async () => {
    const html = `<p>${"word ".repeat(5_000)}</p>`;
    vi.stubGlobal("fetch", makeFetchMock(html));
    const result = await fetchWebpageText("https://example.com", 50);
    expect(result.length).toBeLessThanOrEqual(50);
    vi.unstubAllGlobals();
  });

  it("throws on non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock("Server Error", { ok: false, status: 500, statusText: "Internal Server Error" })
    );
    await expect(fetchWebpageText("https://example.com/broken")).rejects.toThrow(
      /500/
    );
    vi.unstubAllGlobals();
  });

  it("uses WEBPAGE_TEXT_MAX_CHARS as default", () => {
    expect(WEBPAGE_TEXT_MAX_CHARS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe("FETCH_RSS_TOOL definition", () => {
  it("has the correct name and required parameter", () => {
    expect(FETCH_RSS_TOOL.name).toBe("fetch_rss");
    expect(FETCH_RSS_TOOL.parameters.required).toContain("url");
  });

  it("declares an optional max_items parameter", () => {
    expect(FETCH_RSS_TOOL.parameters.properties?.max_items).toBeDefined();
  });
});

describe("FETCH_JSON_TOOL definition", () => {
  it("has the correct name and required parameter", () => {
    expect(FETCH_JSON_TOOL.name).toBe("fetch_json");
    expect(FETCH_JSON_TOOL.parameters.required).toContain("url");
  });

  it("declares an optional headers parameter", () => {
    expect(FETCH_JSON_TOOL.parameters.properties?.headers).toBeDefined();
  });
});

describe("FETCH_WEBPAGE_TEXT_TOOL definition", () => {
  it("has the correct name and required parameter", () => {
    expect(FETCH_WEBPAGE_TEXT_TOOL.name).toBe("fetch_webpage_text");
    expect(FETCH_WEBPAGE_TEXT_TOOL.parameters.required).toContain("url");
  });
});

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

describe("fetchRssHandler", () => {
  it("throws when url argument is missing", async () => {
    await expect(fetchRssHandler({})).rejects.toThrow(/url/);
  });

  it("throws when url is not a string", async () => {
    await expect(fetchRssHandler({ url: 123 })).rejects.toThrow(/url/);
  });

  it("returns a JSON string with feed data", async () => {
    vi.stubGlobal("fetch", makeFetchMock(RSS2_XML));
    const result = await fetchRssHandler({ url: "https://example.com/feed" });
    const parsed = JSON.parse(result) as RssFeed;
    expect(parsed.title).toBe("Test Feed");
    expect(parsed.items).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("respects the max_items argument", async () => {
    vi.stubGlobal("fetch", makeFetchMock(RSS2_XML));
    const result = await fetchRssHandler({
      url: "https://example.com/feed",
      max_items: 1,
    });
    const parsed = JSON.parse(result) as RssFeed;
    expect(parsed.items).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe("fetchJsonHandler", () => {
  it("throws when url argument is missing", async () => {
    await expect(fetchJsonHandler({})).rejects.toThrow(/url/);
  });

  it("throws when url is not a string", async () => {
    await expect(fetchJsonHandler({ url: 99 })).rejects.toThrow(/url/);
  });

  it("throws when headers is not a string", async () => {
    await expect(
      fetchJsonHandler({ url: "https://api.example.com", headers: 42 })
    ).rejects.toThrow(/headers/);
  });

  it("throws when headers is not a valid JSON object string", async () => {
    await expect(
      fetchJsonHandler({ url: "https://api.example.com", headers: "[1,2,3]" })
    ).rejects.toThrow(/headers/);
  });

  it("returns formatted JSON for a valid endpoint", async () => {
    const body = JSON.stringify({ status: "ok" });
    vi.stubGlobal("fetch", makeFetchMock(body));
    const result = await fetchJsonHandler({ url: "https://api.example.com/status" });
    const parsed = JSON.parse(result) as { status: string };
    expect(parsed.status).toBe("ok");
    vi.unstubAllGlobals();
  });

  it("parses and forwards a valid headers string", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => '{"ok":true}',
          json: async () => ({ ok: true }),
        });
      })
    );
    await fetchJsonHandler({
      url: "https://api.example.com",
      headers: '{"X-Token":"abc"}',
    });
    const rawHeaders = capturedInit?.headers;
    const tokenValue =
      rawHeaders instanceof Headers
        ? rawHeaders.get("X-Token")
        : (rawHeaders as Record<string, string> | undefined)?.["X-Token"];
    expect(tokenValue).toBe("abc");
    vi.unstubAllGlobals();
  });
});

describe("fetchWebpageTextHandler", () => {
  it("throws when url argument is missing", async () => {
    await expect(fetchWebpageTextHandler({})).rejects.toThrow(/url/);
  });

  it("throws when url is not a string", async () => {
    await expect(fetchWebpageTextHandler({ url: true })).rejects.toThrow(/url/);
  });

  it("returns stripped plain text for a valid page", async () => {
    const html = "<html><body><p>Hello world</p></body></html>";
    vi.stubGlobal("fetch", makeFetchMock(html));
    const result = await fetchWebpageTextHandler({
      url: "https://example.com",
    });
    expect(result).toBe("Hello world");
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// createDefaultToolRegistry – includes new tools
// ---------------------------------------------------------------------------

describe("createDefaultToolRegistry – external data tools", () => {
  it("registers fetch_rss, fetch_json, and fetch_webpage_text", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.has("fetch_rss")).toBe(true);
    expect(registry.has("fetch_json")).toBe(true);
    expect(registry.has("fetch_webpage_text")).toBe(true);
  });

  it("now contains 5 tools in total", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.size).toBe(5);
  });
});
