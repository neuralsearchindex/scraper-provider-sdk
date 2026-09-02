import * as cheerio from "cheerio";

/**
 * Cheerio-based pure extraction helpers. These operate purely on raw HTML (no
 * network, no browser) — the caller supplies the HTML and a base URL against
 * which relative references are resolved.
 */

export interface ScrapedImage {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * Absolute `<a href>` URLs from the document. With a selector, only anchors
 * inside matching elements are returned. Hrefs are resolved against `baseUrl`;
 * unparseable ones (mailto:, javascript:, …) and non-http(s) schemes are
 * dropped. The result is de-duplicated in document order.
 */
export function extractLinks(
  html: string,
  baseUrl: string,
  selector?: string | null
): string[] {
  const $ = cheerio.load(html);
  const scope = selector ? `${selector} a[href]` : "a[href]";
  const seen = new Set<string>();
  const links: string[] = [];
  $(scope).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
    if (seen.has(resolved.href)) return;
    seen.add(resolved.href);
    links.push(resolved.href);
  });
  return links;
}

/**
 * Image metadata from the document: `<img>` src (resolved absolute, honouring
 * lazy `data-src` / `data-lazy-src`), alt text, and width/height from the
 * element attributes when present. With a selector, only images inside matching
 * elements are collected. Dimensions come from the `width`/`height` attributes
 * (no live layout here), so they're `null` when absent.
 */
export function extractImages(
  html: string,
  baseUrl: string,
  selector?: string | null
): ScrapedImage[] {
  const $ = cheerio.load(html);
  const scope = selector ? `${selector} img` : "img";
  const images: ScrapedImage[] = [];
  $(scope).each((_, node) => {
    const el = $(node);
    const raw =
      el.attr("src") || el.attr("data-src") || el.attr("data-lazy-src") || "";
    let resolved = raw;
    try {
      resolved = raw ? new URL(raw, baseUrl).href : "";
    } catch {
      resolved = raw;
    }
    const width = Number.parseInt(el.attr("width") ?? "", 10);
    const height = Number.parseInt(el.attr("height") ?? "", 10);
    images.push({
      src: resolved,
      alt: el.attr("alt") ?? "",
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
    });
  });
  return images;
}

/**
 * Parse every `<script type="application/ld+json">` block and return the parsed
 * objects. Blocks that fail to parse are skipped rather than throwing, so a
 * single malformed graph never sinks the whole harvest.
 */
export function harvestJsonLd(html: string): unknown[] {
  const $ = cheerio.load(html);
  const nodes: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    try {
      nodes.push(JSON.parse(text));
    } catch {
      // malformed JSON-LD — skip
    }
  });
  return nodes;
}
