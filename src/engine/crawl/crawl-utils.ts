/**
 * URL-filtering helpers for the crawler. Pure functions (no browser, no
 * network) deciding whether a discovered link should be followed — the
 * Firecrawl filtering ideas without its Rust/Redis machinery.
 */

/** Binary/asset extensions never worth crawling as pages. */
const NON_PAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".tiff",
  ".bmp",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".zip",
  ".gz",
  ".tar",
  ".rar",
  ".7z",
  ".exe",
  ".dmg",
  ".pkg",
  ".mp4",
  ".webm",
  ".avi",
  ".flv",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".xlsx",
  ".pptx",
  ".rss",
];

/** URL schemes a headless browser cannot meaningfully navigate. */
const NON_WEB_PROTOCOLS = new Set([
  "mailto:",
  "tel:",
  "sms:",
  "ftp:",
  "ftps:",
  "ssh:",
  "file:",
  "javascript:",
  "data:",
  "telnet:",
]);

/** True when `url` points at an asset file rather than an HTML page. */
export function isFile(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return NON_PAGE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/** True when `url` uses a scheme the crawler cannot fetch (mailto:, tel:, …). */
export function isNonWebProtocol(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return [...NON_WEB_PROTOCOLS].some((proto) => lower.startsWith(proto));
}

/** Non-empty path segments in a URL — its "depth". `/`=0, `/a`=1, `/a/b`=2. */
export function getURLDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/** Strip `www.` so `www.example.com` and `example.com` compare as equal. */
export function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

/** Whether `linkHost` is the same site as `baseHost`, honouring subdomains. */
export function isSameSite(
  linkHost: string,
  baseHost: string,
  allowSubdomains: boolean
): boolean {
  const link = bareHost(linkHost);
  const base = bareHost(baseHost);
  if (link === base) return true;
  return allowSubdomains && link.endsWith(`.${base}`);
}

/** Compile user path patterns into RegExps, dropping invalid ones silently. */
export function compilePatterns(patterns: string[] | undefined): RegExp[] {
  if (!patterns) return [];
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    if (!pattern) continue;
    try {
      compiled.push(new RegExp(pattern));
    } catch {
      // Ignore invalid regex — treat it as "no pattern".
    }
  }
  return compiled;
}

export interface LinkFilterOptions {
  baseHost: string;
  basePath: string;
  maxDepth: number;
  includes: RegExp[];
  excludes: RegExp[];
  allowSubdomains: boolean;
  allowExternalLinks: boolean;
  allowBackwardCrawling: boolean;
  isRobotsAllowed: (url: string) => boolean;
}

export type LinkRejection =
  | "non-web-protocol"
  | "asset-file"
  | "external-host"
  | "backward"
  | "depth"
  | "exclude"
  | "include"
  | "robots";

/**
 * Decide whether `url` (absolute, normalized) should be crawled. `null` = allowed,
 * else the rejection reason. Cheap structural checks first, robots.txt last.
 */
export function rejectLink(
  url: string,
  opts: LinkFilterOptions
): LinkRejection | null {
  if (isNonWebProtocol(url)) return "non-web-protocol";
  if (isFile(url)) return "asset-file";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "non-web-protocol";
  }

  if (
    !opts.allowExternalLinks &&
    !isSameSite(parsed.hostname, opts.baseHost, opts.allowSubdomains)
  ) {
    return "external-host";
  }
  if (
    !opts.allowBackwardCrawling &&
    !opts.allowExternalLinks &&
    !parsed.pathname.startsWith(opts.basePath)
  ) {
    return "backward";
  }
  if (getURLDepth(url) > opts.maxDepth) return "depth";

  const path = parsed.pathname;
  if (opts.excludes.length > 0 && opts.excludes.some((re) => re.test(path))) {
    return "exclude";
  }
  if (opts.includes.length > 0 && !opts.includes.some((re) => re.test(path))) {
    return "include";
  }
  if (!opts.isRobotsAllowed(url)) return "robots";

  return null;
}
