import { gunzipSync } from "node:zlib";

import { parseStringPromise } from "xml2js";

import { scrape } from "../engine";

/**
 * Shared sitemap helpers for provider `discover()` walks. Sites that sit behind
 * Cloudflare can't be fetched plainly, so these go through the engine's
 * challenge-aware {@link scrape} rather than a bare `fetch`, and tolerate both raw
 * sitemap XML and the browser-rendered form (Chrome's XML viewer).
 */

/**
 * Load a sitemap through the engine and return every `<loc>` — whether the
 * document is a `<sitemapindex>` (child sitemap URLs) or a `<urlset>` (page URLs).
 * Returns `[]` on any error so one bad document never sinks discovery.
 *
 * `fetchEngine` defaults to `"browser"` because the callers that need this helper
 * (over the engine's own `crawl` sitemap walker) are the Cloudflare-gated sites;
 * pass `"auto"` for a site that only occasionally challenges.
 */
export async function fetchSitemapLocs(
  sitemapUrl: string,
  fetchEngine: "auto" | "browser" | "curl" = "browser"
): Promise<string[]> {
  try {
    const { fullHtml } = await scrape(sitemapUrl, { fetchEngine });
    return parseSitemapLocs(fullHtml);
  } catch {
    return [];
  }
}

/**
 * Fetch a (possibly gzipped) sitemap over **plain HTTP** and return its XML text —
 * `""` on any network/HTTP/decompression error, so one bad document never sinks a
 * discovery walk. Use this (not {@link fetchSitemapLocs}) for `.xml.gz` sitemaps:
 * the engine's `scrape` renders HTML and can't handle binary gzip, and these gz
 * endpoints aren't Cloudflare-gated so no browser is needed.
 *
 * gzip is detected from the `.gz` extension, a `content-encoding: gzip` header, or
 * the gzip magic bytes (`1f 8b`) in case the extension/header lie.
 */
export async function fetchSitemapXml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    // Only gunzip a gzip *file* body (a `.xml.gz` served as application/gzip): detect it
    // by the `.gz` extension or the gzip magic bytes. Do NOT key off `content-encoding:
    // gzip` — that is HTTP transfer compression, which `fetch` (undici) has already
    // decompressed, so re-gunzipping the plain XML would throw and lose the document.
    const isGzip =
      url.toLowerCase().endsWith(".gz") ||
      (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b);
    return (isGzip ? gunzipSync(buf) : buf).toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Pull `<loc>` values out of sitemap content. Works on raw sitemap XML and on the
 * browser-rendered form (Chrome's `#webkit-xml-viewer-source-xml` keeps the
 * original `<loc>` tags as real elements, so a tag scan matches both). The pretty-
 * printed tree Chrome adds alongside uses entity-escaped `&lt;loc&gt;`, which this
 * deliberately does not match — so each URL is returned once.
 *
 * Per the sitemap protocol, characters inside `<loc>` are XML-escaped (a query
 * separator is written `&amp;`), so entities are decoded here — otherwise a URL
 * like `?a=1&amp;b=2` would parse into a bogus `amp;b` query param downstream.
 */
export function parseSitemapLocs(content: string): string[] {
  const locs = new Set<string>();
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null)
    locs.add(decodeXmlEntities(m[1].trim()));
  return [...locs];
}

/** One `<url>` entry from a `<urlset>` sitemap: its `<loc>` plus optional `<lastmod>`. */
export interface SitemapEntry {
  loc: string;
  /** `<lastmod>` verbatim (ISO date/datetime) when present; omitted otherwise. */
  lastmod?: string;
}

const URL_BLOCK_RE = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const ENTRY_LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/i;
const ENTRY_LASTMOD_RE = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i;

/**
 * Like {@link parseSitemapLocs} but block-aware: parse each `<url>…</url>` of a
 * `<urlset>` into a {@link SitemapEntry}, pairing the entry's `<loc>` with its
 * `<lastmod>`. Regex-based (not xml2js) for the same reason as `parseSitemapLocs` —
 * it must also match the browser-rendered form (Chrome's XML viewer keeps the
 * original `<url>`/`<loc>`/`<lastmod>` tags as real elements; the escaped pretty-tree
 * uses `&lt;…&gt;` and so never matches). Entries are deduped by `loc`, and entity-
 * decoded. Only `<urlset>` entries are returned — a `<sitemapindex>` has `<sitemap>`
 * (not `<url>`) children and yields nothing here (walk it with `parseSitemapLocs`).
 */
export function parseSitemapEntries(content: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  URL_BLOCK_RE.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = URL_BLOCK_RE.exec(content)) !== null) {
    const locMatch = ENTRY_LOC_RE.exec(block[1]);
    if (!locMatch) continue;
    const loc = decodeXmlEntities(locMatch[1].trim());
    if (seen.has(loc)) continue;
    seen.add(loc);
    const modMatch = ENTRY_LASTMOD_RE.exec(block[1]);
    entries.push(
      modMatch
        ? { loc, lastmod: decodeXmlEntities(modMatch[1].trim()) }
        : { loc }
    );
  }
  return entries;
}

/**
 * Load a `<urlset>` sitemap through the engine and return its {@link SitemapEntry}s
 * (`<loc>` + `<lastmod>`). The {@link SitemapEntry}-returning counterpart of
 * {@link fetchSitemapLocs}; same `fetchEngine` semantics and same `[]`-on-error
 * fail-soft. Not for gzipped sitemaps (the engine's `scrape` renders, it does not
 * gunzip) — use {@link fetchSitemapXml} + a dedicated parser for `.xml.gz`.
 */
export async function fetchSitemapEntries(
  sitemapUrl: string,
  fetchEngine: "auto" | "browser" | "curl" = "browser"
): Promise<SitemapEntry[]> {
  try {
    const { fullHtml } = await scrape(sitemapUrl, { fetchEngine });
    return parseSitemapEntries(fullHtml);
  } catch {
    return [];
  }
}

/**
 * A `<url>` entry from an image sitemap: its `<loc>`, optional `<lastmod>`, every
 * `<image:image><image:loc>` thumbnail, and the `<xhtml:link rel="alternate">`
 * `hreflang → href` map (empty when the entry has no alternates).
 */
export interface SitemapImageEntry {
  loc: string;
  lastmod?: string;
  images: string[];
  alternates: Record<string, string>;
}

/** The subset of a parsed `<url>` we read (xml2js keeps namespace prefixes + `$` attrs). */
interface ParsedImageUrl {
  loc?: string[];
  lastmod?: string[];
  "image:image"?: { "image:loc"?: string[] }[];
  "xhtml:link"?: { $?: { hreflang?: string; href?: string } }[];
}

/**
 * Parse a `<urlset>` that carries per-`<url>` images and/or `<xhtml:link>` locale
 * alternates into {@link SitemapImageEntry}s. Uses {@link parseStringPromise} (the
 * crawler's sitemap parser) so namespaces (`image:`, `xhtml:`), attribute maps, and
 * entity decoding are handled for free; entries without a `<loc>` are skipped and a
 * malformed document yields `[]` (fail-soft). For **raw** XML/`.xml` sitemaps (fetch
 * with {@link fetchSitemapXml}); not for the browser-rendered form.
 */
export async function parseSitemapImageEntries(
  xml: string
): Promise<SitemapImageEntry[]> {
  let parsed: { urlset?: { url?: ParsedImageUrl[] } };
  try {
    parsed = await parseStringPromise(xml);
  } catch {
    return [];
  }

  const out: SitemapImageEntry[] = [];
  for (const entry of parsed?.urlset?.url ?? []) {
    const loc = entry.loc?.[0]?.trim();
    if (!loc) continue;
    const images = (entry["image:image"] ?? [])
      .map((img) => img["image:loc"]?.[0]?.trim())
      .filter((u): u is string => Boolean(u));
    const alternates: Record<string, string> = {};
    for (const link of entry["xhtml:link"] ?? []) {
      const hreflang = link.$?.hreflang?.trim();
      const href = link.$?.href?.trim();
      if (hreflang && href) alternates[hreflang] = href;
    }
    const lastmod = entry.lastmod?.[0]?.trim();
    out.push({ loc, images, alternates, ...(lastmod ? { lastmod } : {}) });
  }
  return out;
}

/** Decode the five predefined XML entities (and numeric `&#38;`) found in `<loc>`. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&(?:amp|#38|#x26);/gi, "&"); // decode ampersand last
}
