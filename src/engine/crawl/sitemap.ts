/**
 * Recursive sitemap fetching for the crawler. A sitemap is either a `<urlset>`
 * (flat list of page URLs) or a `<sitemapindex>` (a list of other sitemaps).
 * This walks the index tree, follows nested sitemaps, transparently
 * decompresses `.gz`, dedupes, and stops once `limit` page URLs are collected.
 */
import { gunzipSync } from "node:zlib";
import { parseStringPromise } from "xml2js";

import { DEFAULT_USER_AGENT } from "../constants";
import { isFile } from "./crawl-utils";

/** Hard cap on how many distinct sitemap documents one crawl will fetch. */
const MAX_SITEMAPS = 50;

/** Shape xml2js produces for a parsed sitemap (only the fields we read). */
interface ParsedSitemap {
  urlset?: { url?: Array<{ loc?: string[] }> };
  sitemapindex?: { sitemap?: Array<{ loc?: string[] }> };
}

/** Download a sitemap, decompressing when it is gzip-encoded, and return XML. */
async function fetchSitemapXml(
  sitemapUrl: string,
  timeout: number
): Promise<string> {
  const res = await fetch(sitemapUrl, {
    signal: AbortSignal.timeout(timeout),
    headers: { "User-Agent": DEFAULT_USER_AGENT },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`sitemap HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const encoding = String(
    res.headers.get("content-encoding") ?? ""
  ).toLowerCase();
  const isGzip =
    sitemapUrl.toLowerCase().endsWith(".gz") ||
    encoding.includes("gzip") ||
    // gzip magic bytes, in case the extension/header lie.
    (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b);

  return (isGzip ? gunzipSync(buffer) : buffer).toString("utf-8");
}

/** Pull the single `<loc>` value out of an xml2js `<url>`/`<sitemap>` entry. */
function locOf(entry: { loc?: string[] }): string | null {
  const loc = entry.loc?.[0]?.trim();
  return loc ? loc : null;
}

/**
 * Collect up to `limit` page URLs reachable from `sitemapUrl`, recursing into
 * nested sitemap indexes. `visited` guards against cycles and enforces the
 * global sitemap fetch cap across the whole recursion. Errors on any single
 * sitemap are swallowed so one bad child can't abort the whole tree.
 */
export async function getLinksFromSitemap(
  sitemapUrl: string,
  limit: number,
  timeout: number,
  visited: Set<string> = new Set()
): Promise<string[]> {
  if (visited.size >= MAX_SITEMAPS || visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  let xml: string;
  try {
    xml = await fetchSitemapXml(sitemapUrl, timeout);
  } catch {
    return [];
  }

  let parsed: ParsedSitemap;
  try {
    parsed = (await parseStringPromise(xml)) as ParsedSitemap;
  } catch {
    return [];
  }

  const collected: string[] = [];

  // A sitemap index: recurse into each child sitemap until the limit is met.
  if (parsed.sitemapindex?.sitemap) {
    for (const entry of parsed.sitemapindex.sitemap) {
      if (limit > 0 && collected.length >= limit) break;
      const childUrl = locOf(entry);
      if (!childUrl) continue;
      const remaining = limit > 0 ? limit - collected.length : 0;
      collected.push(
        ...(await getLinksFromSitemap(childUrl, remaining, timeout, visited))
      );
    }
    return dedupeAndCap(collected, limit);
  }

  // A urlset: collect page locs, recursing into any that are themselves
  // sitemaps (some sites nest `.xml` links inside a urlset).
  if (parsed.urlset?.url) {
    for (const entry of parsed.urlset.url) {
      if (limit > 0 && collected.length >= limit) break;
      const loc = locOf(entry);
      if (!loc) continue;

      const lower = loc.toLowerCase();
      if (lower.endsWith(".xml") || lower.endsWith(".xml.gz")) {
        const remaining = limit > 0 ? limit - collected.length : 0;
        collected.push(
          ...(await getLinksFromSitemap(loc, remaining, timeout, visited))
        );
        continue;
      }

      if (!isFile(loc)) collected.push(loc);
    }
  }

  return dedupeAndCap(collected, limit);
}

/** Dedupe while preserving order, then apply the (optional) limit. */
function dedupeAndCap(urls: string[], limit: number): string[] {
  const unique = Array.from(new Set(urls));
  return limit > 0 ? unique.slice(0, limit) : unique;
}
