/**
 * robots.txt fetching + evaluation for the crawler. Fetched once per crawl via
 * the engine's plain-HTTP `fetchHtml` (no browser), parsed with `robots-parser`.
 * A missing/unreachable robots.txt is treated as "no restrictions".
 */
import robotsParserImport from "robots-parser";

import { DEFAULT_USER_AGENT } from "../constants";
import { fetchHtml } from "../fetch";

/**
 * Minimal shape of a parsed robots.txt. Declared locally because the shipped
 * `robots-parser` typings mis-declare the module and don't export this type.
 */
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}

/** Factory typed correctly around the package's broken default-export typings. */
const robotsParser = robotsParserImport as unknown as (
  url: string,
  contents: string
) => Robot;

/** User-Agent token robots.txt rules are matched against. */
const ROBOTS_USER_AGENT = DEFAULT_USER_AGENT;

export interface RobotsChecker {
  /** True when robots.txt permits crawling `url` (or when checks are off). */
  isAllowed(url: string): boolean;
  /** Crawl-delay in ms requested by robots.txt, or 0 when none is set. */
  crawlDelayMs: number;
  /** Absolute sitemap URLs advertised via `Sitemap:` directives. */
  sitemaps: string[];
}

/** An "allow everything" checker used when robots.txt is ignored or missing. */
const ALLOW_ALL: RobotsChecker = {
  isAllowed: () => true,
  crawlDelayMs: 0,
  sitemaps: [],
};

/**
 * Fetch and parse `<origin>/robots.txt` for `seedURL`. Returns a checker that
 * always allows when `ignoreRobotsTxt` is set, or when the file can't be fetched
 * (a missing/unreachable robots.txt is treated as "no restrictions").
 */
export async function loadRobots(
  seedURL: string,
  ignoreRobotsTxt: boolean,
  timeout: number
): Promise<RobotsChecker> {
  if (ignoreRobotsTxt) return ALLOW_ALL;

  let robotsUrl: string;
  try {
    robotsUrl = new URL("/robots.txt", seedURL).href;
  } catch {
    return ALLOW_ALL;
  }

  let content = "";
  try {
    const { html, status } = await fetchHtml(robotsUrl, { timeout });
    // 4xx/5xx (e.g. a 404 HTML error page) means "no rules".
    if (status < 200 || status >= 300) return ALLOW_ALL;
    content = html;
  } catch {
    return ALLOW_ALL;
  }

  const robots = robotsParser(robotsUrl, content);
  const delaySeconds = robots.getCrawlDelay(ROBOTS_USER_AGENT);

  return {
    isAllowed(url: string): boolean {
      // `isAllowed` returns undefined when a URL is out of scope for the file
      // (e.g. different host); default that to allowed.
      return robots.isAllowed(url, ROBOTS_USER_AGENT) ?? true;
    },
    crawlDelayMs:
      typeof delaySeconds === "number" && delaySeconds > 0
        ? delaySeconds * 1000
        : 0,
    sitemaps: robots.getSitemaps(),
  };
}
