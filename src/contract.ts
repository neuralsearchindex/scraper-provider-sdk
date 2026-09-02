/**
 * The provider contract — the SAME shape the central scraper defines in
 * `modules/providers/provider.interface.ts`. Kept self-contained here so a standalone provider app
 * depends only on this SDK. A provider is ordinary data: an id, the hostnames it claims, an optional
 * streaming `discover()`, and an optional deterministic `extractDetails()`.
 */

export type BusinessDomain = "real_estate" | "vehicles";
export type ExtractionStrategy = "manual" | "llm";

/** One discovered listing from an index/search/sitemap source. */
export interface DiscoveredListing {
  url: string;
  images?: string[];
  lastmod?: string;
  /** The provider's native per-listing payload from the discovery source, when it exposes one. */
  raw?: Record<string, unknown>;
}

/** Opaque, JSON-serializable provider progress marker (e.g. `{ page: 5 }`), persisted for resume. */
export type DiscoveryCursor = Record<string, unknown>;

/** Discovery knobs. `resumeFrom` is a cursor a provider previously yielded. */
export interface DiscoverOptions {
  limit?: number;
  language?: string;
  resumeFrom?: DiscoveryCursor;
}

/** One page/batch of discovered listings plus the cursor to resume AFTER it. */
export interface DiscoveryBatch {
  listings: DiscoveredListing[];
  cursor?: DiscoveryCursor;
}

/** A single already-scraped detail page handed to a provider's `extractDetails`. */
export interface ProviderPageInput {
  html: string;
  fullHtml?: string;
  url: string;
  model?: string;
  strategy?: ExtractionStrategy;
}

/** Deterministic detail extraction result. `ad` is the structured listing; `raw` is an escape hatch. */
export interface DetailExtraction {
  ad: Record<string, unknown> | null;
  images?: string[];
  raw?: Record<string, unknown>;
  warnings: string[];
}

export type DetailExtractor = (input: ProviderPageInput) => Promise<DetailExtraction>;

/** A site provider plugin — the unit an author ships. */
export interface SiteProvider {
  readonly id: string;
  readonly domains: readonly string[];
  readonly businessDomain?: BusinessDomain;
  supports?(url: string): boolean;
  discover?(seedUrl: string, opts?: DiscoverOptions): AsyncIterable<DiscoveryBatch>;
  readonly extractDetails?: DetailExtractor;
  readonly strategy?: ExtractionStrategy;
  readonly skipPageContent?: boolean;
  readonly detailFetchEngine?: "auto" | "browser" | "curl";
}

/**
 * Suffix-aware hostname match: strip a leading `www.`, then a domain matches when the hostname equals
 * it or ends with `"." + domain`. A malformed URL never matches. (Mirrors the central's matcher.)
 */
export function matchesDomain(url: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return domains.some((raw) => {
    const d = raw.toLowerCase().replace(/^www\./, "");
    return host === d || host.endsWith(`.${d}`);
  });
}

/** The effective extraction strategy — manual-first: override → provider default → `manual`. */
export function resolveStrategy(
  provider: SiteProvider,
  override?: ExtractionStrategy | null
): ExtractionStrategy {
  return override ?? provider.strategy ?? "manual";
}
