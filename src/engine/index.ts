/**
 * Self-contained scraping engine: a plain-HTTP fast path with automatic
 * escalation to a Cloudflare-aware Playwright ladder, plus HTML → Markdown and
 * cheerio-based link/image/JSON-LD extraction.
 */

export { scrape } from "./scrape";
export type { ScrapeOptions, ScrapeResult, Engine } from "./scrape";

export { htmlToMarkdown } from "./markdown";
export {
  extractLinks,
  extractImages,
  harvestJsonLd,
  type ScrapedImage,
} from "./links-images";

export { crawl, crawlStream } from "./crawl/crawl";
export type { CrawlOptions, CrawlResult, CrawlMode } from "./crawl/crawl";

export { WAIT_UNTIL_OPTIONS, type WaitUntilOption } from "./types";
