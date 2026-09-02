import { createLogger } from "../../logger";

import { scrape, type Engine } from "../scrape";
import { extractLinks } from "../links-images";
import type { WaitUntilOption } from "../types";
import {
  compilePatterns,
  getURLDepth,
  rejectLink,
  type LinkFilterOptions,
} from "./crawl-utils";
import { loadRobots, type RobotsChecker } from "./robots";
import { getLinksFromSitemap } from "./sitemap";

/**
 * Website URL discovery: starting from a seed page, follow links breadth-first
 * (through the engine's adaptive fetch → browser ladder), or read a sitemap.xml.
 * Returns the unique page URLs found — the caller then scrapes them individually.
 */

const log = createLogger({ name: "scraper-crawl" });

export type CrawlMode = "crawl" | "sitemap";

export interface CrawlOptions {
  pageURL: string;
  limit?: number;
  mode?: CrawlMode;
  selector?: string | null;
  waitUntil?: WaitUntilOption;
  timeoutMs?: number;
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  allowSubdomains?: boolean;
  allowExternalLinks?: boolean;
  allowBackwardCrawling?: boolean;
  ignoreRobotsTxt?: boolean;
  fetchEngine?: Engine;
}

export interface CrawlResult {
  source: string;
  mode: CrawlMode;
  count: number;
  urls: string[];
}

/** Default max pages; override via SCRAPER_CRAWL_MAX_PAGES. */
const DEFAULT_LIMIT = (() => {
  const raw = Number.parseInt(process.env.SCRAPER_CRAWL_MAX_PAGES ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 100;
})();

/** Cap absurd robots.txt Crawl-delays; override via SCRAPER_CRAWL_MAX_DELAY_MS. */
const MAX_CRAWL_DELAY_MS = (() => {
  const raw = Number.parseInt(process.env.SCRAPER_CRAWL_MAX_DELAY_MS ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2000;
})();

const DEFAULT_TIMEOUT_MS = 30000;

/** Strip protocol + trailing slash + fragment so the same page is visited once. */
function normalizeURL(urlString: string): string {
  const url = new URL(urlString);
  const port = url.port ? `:${url.port}` : "";
  const hostPath = url.hostname + port + url.pathname + url.search;
  return hostPath.length > 1 && hostPath.endsWith("/")
    ? hostPath.slice(0, -1)
    : hostPath;
}

/** Pause execution for `ms` milliseconds (used to honour Crawl-delay). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load one page through the engine (adaptive fetch → browser ladder) and return
 * its `<a href>` links, optionally scoped to `selector`.
 */
async function extractPageLinks(
  url: string,
  engine: Engine,
  waitUntil: WaitUntilOption,
  timeout: number,
  selector: string | null | undefined
): Promise<string[]> {
  const result = await scrape(url, {
    fetchEngine: engine,
    waitUntil,
    timeoutMs: timeout,
  });
  return extractLinks(result.fullHtml, url, selector);
}

interface CrawlFilters {
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
  allowSubdomains: boolean;
  allowExternalLinks: boolean;
  allowBackwardCrawling: boolean;
}

/**
 * Iterative (not recursive) breadth-first crawl: follow links subject to
 * `filters`, up to `limit` pages. Iterative so a large site cannot blow the
 * call stack.
 */
async function* crawlSiteStream(
  startURL: string,
  limit: number,
  engine: Engine,
  waitUntil: WaitUntilOption,
  timeout: number,
  selector: string | null | undefined,
  filters: CrawlFilters,
  robots: RobotsChecker,
  crawlDelayMs: number
): AsyncGenerator<string> {
  const base = new URL(startURL);
  const filterOpts: LinkFilterOptions = {
    baseHost: base.hostname,
    basePath: base.pathname,
    maxDepth: filters.maxDepth,
    includes: compilePatterns(filters.includePaths),
    excludes: compilePatterns(filters.excludePaths),
    allowSubdomains: filters.allowSubdomains,
    allowExternalLinks: filters.allowExternalLinks,
    allowBackwardCrawling: filters.allowBackwardCrawling,
    isRobotsAllowed: (url) => robots.isAllowed(url),
  };

  const visited = new Set<string>();
  let count = 0;
  const queue: string[] = [startURL];

  while (queue.length > 0 && (limit === 0 || count < limit)) {
    const currentURL = queue.shift() as string;
    const key = normalizeURL(currentURL);
    if (visited.has(key)) continue;
    visited.add(key);
    if (!robots.isAllowed(currentURL)) continue;

    let hrefs: string[];
    try {
      hrefs = await extractPageLinks(
        currentURL,
        engine,
        waitUntil,
        timeout,
        selector
      );
    } catch {
      continue; // unreachable / navigation error — skip this URL
    }

    const normalized = base.protocol + "//" + key;
    count++;
    yield normalized;
    log.debug(`crawled (${count}): ${normalized}`);

    for (const href of hrefs) {
      // Resolve to an absolute URL and drop the fragment before filtering.
      let absolute: string;
      try {
        const u = new URL(href, currentURL);
        u.hash = "";
        absolute = u.href;
      } catch {
        continue; // malformed href (mailto:, javascript:, etc.)
      }
      if (visited.has(normalizeURL(absolute))) continue;
      if (rejectLink(absolute, filterOpts) !== null) continue;
      queue.push(absolute);
    }

    // Honour the site's requested Crawl-delay between page loads (capped).
    if (crawlDelayMs > 0 && queue.length > 0) await sleep(crawlDelayMs);
  }
}

/**
 * Stream a site's page URLs incrementally (BFS crawl, or sitemap.xml locs). Yields
 * each URL as it's found, so a caller can persist/checkpoint as it goes rather than
 * waiting for the whole crawl. {@link crawl} buffers this into an array.
 */
export async function* crawlStream(options: CrawlOptions): AsyncIterable<string> {
  const {
    pageURL,
    limit = DEFAULT_LIMIT,
    mode = "crawl",
    selector,
    waitUntil = "domcontentloaded",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxDepth,
    includePaths = [],
    excludePaths = [],
    allowSubdomains = false,
    allowExternalLinks = false,
    allowBackwardCrawling = false,
    ignoreRobotsTxt = false,
    fetchEngine = "auto",
  } = options;

  // Normalize away any trailing slash on the seed URL.
  const seed = pageURL.endsWith("/") ? pageURL.slice(0, -1) : pageURL;

  if (mode === "sitemap") {
    // getLinksFromSitemap returns the whole set at once (one document walk).
    for (const u of await getLinksFromSitemap(seed, limit, timeoutMs)) yield u;
    return;
  }

  // Fetch robots.txt once up front so every candidate link is checked against
  // the same rules, then respect a (capped) Crawl-delay between page loads.
  const robots = await loadRobots(seed, ignoreRobotsTxt, timeoutMs);
  const crawlDelayMs = Math.min(robots.crawlDelayMs, MAX_CRAWL_DELAY_MS);
  // Cap depth relative to the seed so `maxDepth` counts hops below the starting page.
  const depthCap = getURLDepth(seed) + (maxDepth ?? Number.MAX_SAFE_INTEGER);

  yield* crawlSiteStream(
    seed,
    limit,
    fetchEngine,
    waitUntil,
    timeoutMs,
    selector,
    {
      maxDepth: depthCap,
      includePaths,
      excludePaths,
      allowSubdomains,
      allowExternalLinks,
      allowBackwardCrawling,
    },
    robots,
    crawlDelayMs
  );
}

/** Discover a site's page URLs by BFS crawl or by reading its sitemap.xml (buffered). */
export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const urls: string[] = [];
  for await (const u of crawlStream(options)) urls.push(u);
  if (urls.length === 0) {
    throw new Error("No URLs could be discovered from the given page.");
  }
  return { source: options.pageURL, mode: options.mode ?? "crawl", count: urls.length, urls };
}
