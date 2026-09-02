import * as cheerio from "cheerio";
import { createProxyFetcher } from "./proxy-fetch";
import { createLogger } from "../logger";

import { DEFAULT_USER_AGENT } from "./constants";
import { textLooksLikeChallenge } from "../challenge";

/**
 * The plain-HTTP fast path: fetch a page and parse it with cheerio instead of
 * driving a real browser. Most sites have no anti-bot protection and are fully
 * server-rendered, so this returns the same content the browser would in a
 * fraction of the time — and, crucially, without consuming a browser
 * concurrency slot.
 *
 * Unlike the original engine, this port has NO per-domain persistence and NO
 * embeddings/topic ranking: it exposes the raw fetch + classification primitives
 * and leaves the fetch-vs-browser orchestration to `scrape.ts`.
 */

const log = createLogger({ name: "scraper-engine" });

/**
 * Accept-Language sent on fast-path requests. Defaults to `de-CH` to match the
 * playwright-vnc browser locale (`PLAYWRIGHT_VNC_LOCALE`, default `de-CH`), so a
 * site serving localized content returns the same language on both paths.
 */
const ACCEPT_LANGUAGE = process.env.SCRAPER_ACCEPT_LANGUAGE || "de-CH";

/**
 * Minimum visible body-text length for a fetched page to count as "real
 * content" rather than an empty SPA shell. A JS-rendered site typically returns
 * `<div id="root"></div>` with almost no text — below this threshold we hand off
 * to the browser (which runs the JS). Overridable via env.
 */
const MIN_CONTENT_CHARS = (() => {
  const raw = Number.parseInt(
    process.env.SCRAPER_FETCH_MIN_CONTENT_CHARS ?? "",
    10
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
})();

/**
 * Shared HTTP client for the fast path: the workspace proxy-rotating fetcher.
 * It only kicks in when the direct request is blocked (403/429), capped at
 * `maxRetries: 2` attempts so a hard block fails fast into the browser rung
 * rather than churning the free-proxy list. Created lazily so importing this
 * module never probes the network.
 */
let httpClient: ReturnType<typeof createProxyFetcher> | undefined;
function getHttpClient(): ReturnType<typeof createProxyFetcher> {
  if (!httpClient) {
    httpClient = createProxyFetcher({
      maxRetries: 2,
      logger: {
        info: (msg) => log.debug(msg),
        warn: (msg) => log.warn(msg),
      },
    });
  }
  return httpClient;
}

/** HTTP statuses that signal a block / rate-limit rather than usable content. */
const BLOCK_STATUSES = new Set([401, 403, 407, 429, 503]);

export function isBlockStatus(status: number): boolean {
  return BLOCK_STATUSES.has(status);
}

/** A `<script>` payload we surface (e.g. JSON-LD structured data). */
export interface ExtractedScript {
  type: string;
  content: string;
}

/** The content shape `extractContentFromHtml` returns. */
export interface FetchedContent {
  /** The (optionally selector-scoped) body HTML. */
  html: string;
  /** Raw contents of matched `<script>` tags, from anywhere in the document. */
  scripts: ExtractedScript[];
}

/** Result of a raw fetch: the response body plus its HTTP status. */
export interface FetchResult {
  html: string;
  status: number;
}

export interface FetchHtmlOptions {
  timeout?: number;
  acceptLanguage?: string;
  /** Extra request headers (e.g. a Cookie). Merged over the defaults. */
  headers?: Record<string, string>;
}

function buildHeaders(
  acceptLanguage: string,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept-Language": acceptLanguage,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...(extra ?? {}),
  };
}

/**
 * Fetch `url` over plain HTTP with a realistic desktop UA and Accept-Language.
 * Tries a direct request first; if that errors or returns a block status, it
 * retries through the proxy-rotating fetcher. Returns the body text and status
 * regardless of status code (a 403 body still carries the challenge markers we
 * detect). Never launches a browser.
 */
export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {}
): Promise<FetchResult> {
  const {
    timeout = 15000,
    acceptLanguage = ACCEPT_LANGUAGE,
    headers,
  } = options;
  const requestHeaders = buildHeaders(acceptLanguage, headers);

  // Direct attempt first (plain global fetch) — fast and proxy-free for the
  // common unprotected case.
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: requestHeaders,
    });
    const html = await res.text();
    if (!isBlockStatus(res.status)) {
      return { html, status: res.status };
    }
    log.debug(
      `${url}: direct fetch returned block status ${res.status}, retrying via proxy`
    );
  } catch (err) {
    log.debug(
      `${url}: direct fetch errored (${
        (err as Error).message?.split("\n")[0]
      }), retrying via proxy`
    );
  }

  // Fallback: proxy-rotating fetcher (only rotates on 403/429).
  const res = await getHttpClient().fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: requestHeaders,
  });
  const html = await res.text();
  return { html, status: res.status };
}

/**
 * Selector-scoped body HTML plus allowed `<script>` payloads: with a selector,
 * join the matched elements' outer HTML; otherwise the whole body. `<script>`
 * payloads (e.g. JSON-LD) are pulled from the entire document — head included —
 * because structured data usually lives in the head.
 */
export function extractContentFromHtml(
  html: string,
  selector: string | null | undefined,
  allowedScriptTypes: string[]
): FetchedContent {
  const $ = cheerio.load(html);

  let scoped: string;
  if (selector) {
    scoped = $(selector)
      .map((_, el) => $.html(el))
      .get()
      .filter(Boolean)
      .join("\n");
  } else {
    scoped = $("body").html() ?? "";
  }

  const scripts: ExtractedScript[] = [];
  if (allowedScriptTypes.length > 0) {
    const query = allowedScriptTypes
      .map((type) => `script[type="${type}"]`)
      .join(",");
    $(query).each((_, el) => {
      const content = $(el).text().trim();
      if (content) {
        scripts.push({ type: $(el).attr("type") ?? "", content });
      }
    });
  }

  return { html: scoped, scripts };
}

/** Whether fetched HTML is a Cloudflare-style interstitial rather than the page. */
export function htmlLooksLikeChallenge(html: string): boolean {
  const $ = cheerio.load(html);
  const text = `${$("title").text()} ${$("body").text()}`;
  const hasTurnstile = $('[name="cf-turnstile-response"]').length > 0;
  return textLooksLikeChallenge(text, hasTurnstile);
}

/** Length of a page's visible body text (used for the thin-shell check). */
export function bodyTextLength(html: string): number {
  return cheerio.load(html)("body").text().trim().length;
}

export interface ContentClassification {
  strategy: "fetch" | "browser";
  reason: string;
}

/**
 * The single content-fetchability verdict. Returns `browser` when the response
 * is a block status, looks like a challenge, or is a thin shell with no
 * structured data; otherwise `fetch`.
 */
export function classifyFetchedContent(
  html: string,
  status: number,
  allowedScriptTypes: string[] = ["application/ld+json"]
): ContentClassification {
  if (isBlockStatus(status)) {
    return { strategy: "browser", reason: `block status ${status}` };
  }
  if (status < 200 || status >= 400) {
    return { strategy: "browser", reason: `http status ${status}` };
  }
  if (htmlLooksLikeChallenge(html)) {
    return { strategy: "browser", reason: "challenge interstitial" };
  }
  const textLen = bodyTextLength(html);
  if (textLen >= MIN_CONTENT_CHARS) {
    return { strategy: "fetch", reason: `${textLen} chars body text` };
  }
  // Thin body, but a JSON-LD (or other allowed) payload can still carry the
  // whole listing — many detail pages are exactly this shape.
  const { scripts } = extractContentFromHtml(html, null, allowedScriptTypes);
  if (scripts.length > 0) {
    return { strategy: "fetch", reason: "thin body but has structured data" };
  }
  return {
    strategy: "browser",
    reason: `thin body (${textLen} < ${MIN_CONTENT_CHARS} chars), no structured data`,
  };
}
