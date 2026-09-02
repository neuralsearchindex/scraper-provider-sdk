import * as cheerio from "cheerio";

/**
 * A minimal, dependency-light engine for DETERMINISTIC providers (plain HTTP + cheerio + sitemap +
 * JSON-LD) — enough to build a `discover()`/`extractDetails()` that needs neither a headless browser
 * nor an LLM, so the standalone worker image stays tiny. Sites behind Cloudflare or that require the
 * full browser ladder are a later add-on (the central engine handles those).
 */

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; neuralsearchindex-scraper-provider/0.1; +https://neuralsearchindex.dev)";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Plain-HTTP GET returning the response body as text (throws on non-2xx). */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": DEFAULT_UA, ...opts.headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a page's HTML (alias for {@link fetchText}; both the raw body and full document). */
export const fetchHtml = fetchText;

export interface RenderOptions {
  /** CDP endpoint of a REMOTE browser (e.g. playwright-vnc: `http://playwright-vnc:9222`). */
  cdpUrl: string;
  /** Playwright waitUntil (default `networkidle`). */
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeoutMs?: number;
  userAgent?: string;
}

/**
 * Render a JS-heavy page via a REMOTE browser over CDP and return its HTML. Uses `playwright-core`,
 * an OPTIONAL peer dependency — install it (and point `cdpUrl` at a running browser, e.g. the
 * platform's playwright-vnc) only for providers that need JS rendering. Deterministic providers that
 * use {@link fetchHtml} pull in neither playwright nor a browser, so their image stays tiny.
 */
export async function fetchRendered(url: string, opts: RenderOptions): Promise<string> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new Error(
      "fetchRendered requires the optional peer dependency 'playwright-core' — add it to your provider app to enable browser rendering."
    );
  }
  const browser = await chromium.connectOverCDP(opts.cdpUrl);
  try {
    const context = await browser.newContext(opts.userAgent ? { userAgent: opts.userAgent } : undefined);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: opts.waitUntil ?? "networkidle", timeout: opts.timeoutMs ?? 45_000 });
      return await page.content();
    } finally {
      await context.close();
    }
  } finally {
    // Close only our connection; the remote browser process stays up for other jobs.
    await browser.close();
  }
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
const URL_BLOCK_RE = /<url>([\s\S]*?)<\/url>/gi;
const LASTMOD_RE = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse a sitemap's `<loc>`s (works for both a urlset and a sitemapindex). */
export function parseSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(LOC_RE)) out.push(decodeXmlEntities(m[1].trim()));
  return out;
}

/** Parse a `<urlset>` sitemap into `{ loc, lastmod? }` entries. */
export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const block of xml.matchAll(URL_BLOCK_RE)) {
    const body = block[1];
    const loc = LOC_RE.exec(body)?.[1] ?? body.match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    LOC_RE.lastIndex = 0;
    if (!loc) continue;
    const lastmod = LASTMOD_RE.exec(body)?.[1];
    out.push(lastmod ? { loc: decodeXmlEntities(loc.trim()), lastmod: lastmod.trim() } : { loc: decodeXmlEntities(loc.trim()) });
  }
  return out;
}

/** Fetch + parse a sitemap into `{ loc, lastmod? }` entries. Fail-soft (returns `[]` on error). */
export async function fetchSitemapEntries(url: string, opts?: FetchOptions): Promise<SitemapEntry[]> {
  try {
    return parseSitemapEntries(await fetchText(url, opts));
  } catch {
    return [];
  }
}

/** Fetch + parse a sitemap's `<loc>`s. Fail-soft. */
export async function fetchSitemapLocs(url: string, opts?: FetchOptions): Promise<string[]> {
  try {
    return parseSitemapLocs(await fetchText(url, opts));
  } catch {
    return [];
  }
}

/** Absolute, deduped anchor hrefs on a page (optionally scoped to a CSS selector). */
export function extractLinks(html: string, baseUrl: string, selector?: string): string[] {
  const $ = cheerio.load(html);
  const scope = selector ? $(selector) : $.root();
  const seen = new Set<string>();
  scope.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      seen.add(new URL(href, baseUrl).toString());
    } catch {
      /* skip malformed */
    }
  });
  return [...seen];
}

/** All schema.org JSON-LD objects embedded in a page (parsed, fail-soft per block). */
export function harvestJsonLd(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      /* skip invalid JSON-LD */
    }
  });
  return out;
}
