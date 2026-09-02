import * as cheerio from "cheerio";
import type { Page } from "playwright-core";
import { createLogger } from "../logger";

import type { WaitUntilOption } from "./types";
import { classifyFetchedContent, fetchHtml, type FetchResult } from "./fetch";
// `../browser` is imported LAZILY inside scrapeWithBrowser so the light fetch/crawl path never
// loads playwright-core — deterministic providers stay browserless.

const log = createLogger({ name: "scraper-engine" });

/** Which fetch engine the caller wants: automatic, forced browser, or fetch-only. */
export type Engine = "auto" | "browser" | "curl";

export interface ScrapeOptions {
  /** Which engine to use (default "auto"). */
  fetchEngine?: Engine;
  /** CSS selector to scope the returned content HTML. */
  selector?: string | null;
  /** Wait for this selector to appear before extracting (browser path only). */
  waitForSelector?: string | null;
  /** When to consider navigation complete (browser path). */
  waitUntil?: WaitUntilOption;
  /** Navigation / fetch timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Accept-Language, e.g. "de-CH". */
  locale?: string;
  /** Cookie header to send with the request. */
  cookies?: string | null;
  /** Explicit proxy URL for this request (unused placeholder — proxy is env-driven). */
  proxyUrl?: string | null;
  /** Abort image/media/font requests. */
  blockMedia?: boolean;
  /** When set, SKIP fetching and use this HTML as the document. */
  html?: string;
  /** Capture a full-page screenshot (forces the browser path). */
  screenshot?: boolean;
}

export interface ScrapeResult {
  url: string;
  status: number;
  /** Content HTML: selector-scoped when a selector is given, else the body. */
  html: string;
  /** The full document HTML. */
  fullHtml: string;
  title: string;
  /** From `<meta name=description>` / `og:description`. */
  description: string;
  engineUsed: "fetch" | "browser" | "supplied";
  /** Present when a screenshot was requested. */
  screenshotDataUri?: string;
}

/** Title from `<title>`; falls back to the first `<h1>`. */
function extractTitle($: cheerio.CheerioAPI): string {
  const title = $("title").first().text().trim();
  if (title) return title;
  return $("h1").first().text().trim();
}

/** Description from `<meta name=description>` or `og:description`. */
function extractDescription($: cheerio.CheerioAPI): string {
  const name = $('meta[name="description"]').attr("content");
  if (name && name.trim()) return name.trim();
  const og = $('meta[property="og:description"]').attr("content");
  if (og && og.trim()) return og.trim();
  return "";
}

/** Selector-scoped HTML (joined outerHTML) or the full body when no selector. */
function scopedHtml($: cheerio.CheerioAPI, selector?: string | null): string {
  if (selector) {
    return $(selector)
      .map((_, el) => $.html(el))
      .get()
      .filter(Boolean)
      .join("\n");
  }
  return $("body").html() ?? "";
}

/** Build a ScrapeResult from a full HTML document via cheerio. */
function resultFromHtml(
  url: string,
  status: number,
  fullHtml: string,
  engineUsed: ScrapeResult["engineUsed"],
  selector: string | null | undefined,
  screenshotDataUri?: string
): ScrapeResult {
  const $ = cheerio.load(fullHtml);
  return {
    url,
    status,
    html: scopedHtml($, selector),
    fullHtml,
    title: extractTitle($),
    description: extractDescription($),
    engineUsed,
    ...(screenshotDataUri ? { screenshotDataUri } : {}),
  };
}

/**
 * Drive the browser path: load `url` on the escalation ladder, wait out any
 * Cloudflare interstitial + optional selector, and return the full document HTML
 * (plus an optional full-page screenshot).
 */
async function scrapeWithBrowser(
  url: string,
  opts: ScrapeOptions
): Promise<{ status: number; fullHtml: string; screenshotDataUri?: string }> {
  const { loadPage, waitForChallengeToClear } = await import("../browser");

  const extraHTTPHeaders: Record<string, string> = {};
  if (opts.locale) extraHTTPHeaders["Accept-Language"] = opts.locale;
  if (opts.cookies) extraHTTPHeaders["Cookie"] = opts.cookies;

  return loadPage(url, {
    waitUntil: opts.waitUntil ?? "domcontentloaded",
    timeout: opts.timeoutMs ?? 30000,
    blockMedia: opts.blockMedia,
    ...(Object.keys(extraHTTPHeaders).length > 0 ? { extraHTTPHeaders } : {}),
    async evaluate(page: Page, response) {
      // Wait out any Cloudflare Turnstile interstitial + DOM settle.
      await waitForChallengeToClear(page);
      if (opts.waitForSelector) {
        await page
          .waitForSelector(opts.waitForSelector, {
            timeout: opts.timeoutMs ?? 30000,
          })
          .catch(() => {
            // Best-effort — proceed with whatever rendered.
          });
      }
      const fullHtml = await page.content();
      const status = response?.status() ?? 200;
      let screenshotDataUri: string | undefined;
      if (opts.screenshot) {
        const buffer = await page.screenshot({ fullPage: true, type: "png" });
        screenshotDataUri = `data:image/png;base64,${buffer.toString("base64")}`;
      }
      return { status, fullHtml, screenshotDataUri };
    },
  });
}

/**
 * Scrape `url` into a normalized {@link ScrapeResult}.
 *
 * Engine selection:
 * - `opts.html` set → no network; parse the supplied HTML (`engineUsed: "supplied"`).
 * - `fetchEngine: "browser"` OR `screenshot` → straight to the browser ladder.
 * - `fetchEngine: "curl"` → plain HTTP only; returns whatever it got even if the
 *   classifier says the content is incomplete (never escalates to the browser).
 * - `fetchEngine: "auto"` (default) → try plain HTTP; if
 *   {@link classifyFetchedContent} says the content is complete, use it; else
 *   fall back to the browser ladder.
 */
export async function scrape(
  url: string,
  opts: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const engine = opts.fetchEngine ?? "auto";

  // 1. Supplied HTML — no network.
  if (opts.html !== undefined) {
    return resultFromHtml(url, 200, opts.html, "supplied", opts.selector);
  }

  // 2. Forced browser, or a screenshot is requested (needs a live page).
  if (engine === "browser" || opts.screenshot) {
    const { status, fullHtml, screenshotDataUri } = await scrapeWithBrowser(
      url,
      opts
    );
    return resultFromHtml(
      url,
      status,
      fullHtml,
      "browser",
      opts.selector,
      screenshotDataUri
    );
  }

  const fetchHeaders: Record<string, string> = {};
  if (opts.cookies) fetchHeaders["Cookie"] = opts.cookies;

  // 3. curl / auto both start with the plain-HTTP fetch.
  let fetched: FetchResult | undefined;
  try {
    fetched = await fetchHtml(url, {
      timeout: opts.timeoutMs ?? 30000,
      ...(opts.locale ? { acceptLanguage: opts.locale } : {}),
      ...(Object.keys(fetchHeaders).length > 0
        ? { headers: fetchHeaders }
        : {}),
    });
  } catch (err) {
    log.debug(
      `${url}: fetch errored (${(err as Error).message?.split("\n")[0]})`
    );
    // curl is fetch-only: with no HTML at all we cannot proceed, rethrow.
    if (engine === "curl") throw err;
    // auto: fall back to the browser.
    fetched = undefined;
  }

  if (engine === "curl") {
    // Return whatever we got — never escalate.
    const { html, status } = fetched!;
    return resultFromHtml(url, status, html, "fetch", opts.selector);
  }

  // 4. auto: use the fetch result when the classifier says it's complete.
  if (fetched) {
    const verdict = classifyFetchedContent(fetched.html, fetched.status);
    if (verdict.strategy === "fetch") {
      log.debug(`${url}: served via fetch (${verdict.reason})`);
      return resultFromHtml(
        url,
        fetched.status,
        fetched.html,
        "fetch",
        opts.selector
      );
    }
    log.debug(`${url}: fetch incomplete (${verdict.reason}), using browser`);
  }

  // 5. auto fallback: the browser ladder.
  const { status, fullHtml, screenshotDataUri } = await scrapeWithBrowser(
    url,
    opts
  );
  return resultFromHtml(
    url,
    status,
    fullHtml,
    "browser",
    opts.selector,
    screenshotDataUri
  );
}
