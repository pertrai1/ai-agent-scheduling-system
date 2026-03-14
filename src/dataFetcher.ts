// ---------------------------------------------------------------------------
// External data fetch module
// Provides helpers for fetching RSS/Atom feeds, JSON APIs, and web page text.
// All functions use the global `fetch` API (Node.js ≥ 18).
// ---------------------------------------------------------------------------

/** A single item extracted from an RSS or Atom feed. */
export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  guid?: string;
}

/** A parsed RSS or Atom feed. */
export interface RssFeed {
  title: string;
  description: string;
  link: string;
  items: RssItem[];
}

/** Default maximum number of items returned from a feed. */
export const RSS_FEED_MAX_ITEMS = 20;
/** Default maximum characters returned from a web page text extraction. */
export const WEBPAGE_TEXT_MAX_CHARS = 10_000;
/** Default maximum characters returned from a JSON API response. */
export const JSON_API_MAX_CHARS = 10_000;

// ---------------------------------------------------------------------------
// HTML / XML utilities
// ---------------------------------------------------------------------------

/**
 * Strips HTML/XML tags and decodes common HTML entities from a string,
 * returning readable plain text. Entity decoding is done in a single pass
 * to avoid double-unescaping (e.g. `&amp;lt;` → `&lt;`, not `<`).
 */
export function stripHtmlTags(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script[^>]*>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Decode named and numeric HTML entities in a single pass to avoid
  // inadvertent double-unescaping of sequences like &amp;lt;
  return stripped.replace(
    /&(?:amp|lt|gt|quot|apos|#(\d+));/g,
    (match, code: string | undefined) => {
      if (code !== undefined) return String.fromCharCode(Number(code));
      switch (match) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return match;
      }
    }
  );
}

/** Strips a CDATA wrapper from XML text content, if present. */
function stripCdata(text: string): string {
  const match = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(text.trim());
  return match ? match[1].trim() : text;
}

/**
 * Extracts the text content of the first matching XML tag (with optional
 * attributes) from an XML string.  Returns an empty string if not found.
 */
function extractFirstTagContent(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = re.exec(xml);
  if (!match) return "";
  return stripCdata(match[1].trim());
}

/**
 * Extracts the `href` attribute value from the first `<link>` element that
 * carries an `href` attribute.  Used for Atom feed links.
 */
function extractAtomLinkHref(xml: string): string {
  const match = /<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i.exec(xml);
  return match ? match[1] : "";
}

// ---------------------------------------------------------------------------
// RSS / Atom parsing
// ---------------------------------------------------------------------------

/** Parses an RSS 2.0 XML string into an {@link RssFeed}. */
function parseRss2Feed(xml: string, maxItems: number): RssFeed {
  // Scope the channel-level fields to the content before the first <item>
  const firstItemIdx = xml.indexOf("<item");
  const channelHeader = firstItemIdx !== -1 ? xml.slice(0, firstItemIdx) : xml;

  const title = stripHtmlTags(extractFirstTagContent(channelHeader, "title"));
  const description = stripHtmlTags(
    extractFirstTagContent(channelHeader, "description")
  );
  const link = extractFirstTagContent(channelHeader, "link");

  const items: RssItem[] = [];
  const itemRe = /<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null && items.length < maxItems) {
    const itemXml = match[0];
    items.push({
      title: stripHtmlTags(extractFirstTagContent(itemXml, "title")),
      link: extractFirstTagContent(itemXml, "link"),
      description: stripHtmlTags(
        extractFirstTagContent(itemXml, "description")
      ),
      pubDate: extractFirstTagContent(itemXml, "pubDate") || undefined,
      guid: extractFirstTagContent(itemXml, "guid") || undefined,
    });
  }

  return { title, description, link, items };
}

/** Parses an Atom 1.0 XML string into an {@link RssFeed}. */
function parseAtomFeed(xml: string, maxItems: number): RssFeed {
  const firstEntryIdx = xml.indexOf("<entry");
  const feedHeader =
    firstEntryIdx !== -1 ? xml.slice(0, firstEntryIdx) : xml;

  const title = stripHtmlTags(extractFirstTagContent(feedHeader, "title"));
  const description = stripHtmlTags(
    extractFirstTagContent(feedHeader, "subtitle")
  );
  const link = extractAtomLinkHref(feedHeader);

  const items: RssItem[] = [];
  const entryRe = /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRe.exec(xml)) !== null && items.length < maxItems) {
    const entryXml = match[0];
    // <summary> or <content> as description; prefer summary
    const summary =
      extractFirstTagContent(entryXml, "summary") ||
      extractFirstTagContent(entryXml, "content");
    const published =
      extractFirstTagContent(entryXml, "published") ||
      extractFirstTagContent(entryXml, "updated") ||
      undefined;
    items.push({
      title: stripHtmlTags(extractFirstTagContent(entryXml, "title")),
      link: extractAtomLinkHref(entryXml),
      description: stripHtmlTags(summary),
      pubDate: published || undefined,
      guid: extractFirstTagContent(entryXml, "id") || undefined,
    });
  }

  return { title, description, link, items };
}

/**
 * Parses an RSS 2.0 or Atom 1.0 XML string into a structured {@link RssFeed}.
 * Detection is based on the Atom namespace declaration (most authoritative),
 * falling back to structural checks: presence of `<feed` and `<entry>` elements
 * without a `<channel>` element (RSS 2.0 marker).
 * Returns at most `maxItems` items (default: {@link RSS_FEED_MAX_ITEMS}).
 */
export function parseRssFeed(
  xml: string,
  maxItems = RSS_FEED_MAX_ITEMS
): RssFeed {
  // Detect Atom by the namespace attribute value in the root <feed> element,
  // or by structural indicators (<feed> + <entry> without <channel>).
  // We match the namespace URI in an XML attribute context (xmlns="..." or xmlns:*="...")
  // to avoid false positives from the namespace string appearing in content text.
  const isAtom =
    /xmlns(?::\w+)?=["']http:\/\/www\.w3\.org\/2005\/Atom["']/.test(xml) ||
    (/<feed[\s>]/.test(xml) && /<entry[\s>]/.test(xml) && !xml.includes("<channel"));
  return isAtom
    ? parseAtomFeed(xml, maxItems)
    : parseRss2Feed(xml, maxItems);
}

// ---------------------------------------------------------------------------
// Public fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetches an RSS or Atom feed from `url` and returns a structured
 * {@link RssFeed} with at most `maxItems` entries.
 * Throws on network errors or non-OK HTTP responses.
 */
export async function fetchRssFeed(
  url: string,
  maxItems = RSS_FEED_MAX_ITEMS
): Promise<RssFeed> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for URL: ${url}`
    );
  }
  const xml = await response.text();
  return parseRssFeed(xml, maxItems);
}

/**
 * Fetches a JSON API endpoint with optional request `headers`.
 * Returns the parsed response formatted as a pretty-printed JSON string,
 * truncated to `maxChars` characters.
 * Throws on network errors or non-OK HTTP responses.
 */
export async function fetchJsonApi(
  url: string,
  headers?: Record<string, string>,
  maxChars = JSON_API_MAX_CHARS
): Promise<string> {
  const response = await fetch(url, { headers: headers ?? {} });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for URL: ${url}`
    );
  }
  const json: unknown = await response.json();
  const text = JSON.stringify(json, null, 2);
  return text.slice(0, maxChars);
}

/**
 * Fetches a web page from `url`, strips HTML tags, and returns the resulting
 * plain text truncated to `maxChars` characters.
 * Throws on network errors or non-OK HTTP responses.
 */
export async function fetchWebpageText(
  url: string,
  maxChars = WEBPAGE_TEXT_MAX_CHARS
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for URL: ${url}`
    );
  }
  const html = await response.text();
  return stripHtmlTags(html).slice(0, maxChars);
}
