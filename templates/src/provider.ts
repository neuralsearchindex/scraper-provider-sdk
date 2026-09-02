import {
  fetchSitemapEntries,
  harvestJsonLd,
  type DiscoverOptions,
  type DiscoveryBatch,
  type ProviderPageInput,
  type SiteProvider,
} from "@neuralsearchindex/scraper-provider-sdk";

/**
 * __PROVIDER_ID__ — a standalone scraper provider.
 *
 * This is an ORDINARY SiteProvider: no Redis/BullMQ/worker awareness. The SDK's `runProviderWorker`
 * drives it (discovery streaming + detail scraping) and reports results to the central scraper.
 *
 * Fill in the two hooks below for your site:
 *   - `discover()`  — yield batches of listing URLs (cheapest structured source first: sitemap/RSS/API).
 *   - `extractDetails()` — deterministically map one detail page to a structured ad (JSON-LD/meta/embedded JSON).
 * Export pure helpers (URL builders, parsers) and unit-test them in `__PROVIDER_ID__.provider.test.ts`.
 */

const ORIGIN = "https://example.com"; // TODO: your site origin
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`; // TODO: the sitemap whose <loc>s are detail URLs

/** TODO: true for a detail-page URL (vs a category/search page). */
export function isDetailUrl(url: string): boolean {
  return /\/listing\/\d+/.test(url);
}

export default function __PROVIDER_FACTORY__(): SiteProvider {
  return {
    id: "__PROVIDER_ID__",
    domains: ["example.com"], // TODO: the hostnames this provider claims
    businessDomain: "real_estate", // or "vehicles"
    skipPageContent: true, // deterministic source (JSON-LD) — no page markdown needed

    async *discover(_seedUrl: string, opts?: DiscoverOptions): AsyncIterable<DiscoveryBatch> {
      const entries = await fetchSitemapEntries(SITEMAP_URL);
      const listings = entries
        .filter((e) => isDetailUrl(e.loc))
        .map((e) => (e.lastmod ? { url: e.loc, lastmod: e.lastmod } : { url: e.loc }));
      const limited = opts?.limit ? listings.slice(0, opts.limit) : listings;
      yield { listings: limited };
    },

    async extractDetails(input: ProviderPageInput) {
      // TODO: map your site's detail page to a structured ad. This example reads schema.org JSON-LD.
      const jsonld = harvestJsonLd(input.fullHtml ?? input.html);
      const node = jsonld.find((n) => typeof n === "object");
      if (!node) return { ad: null, warnings: ["no JSON-LD found"] };
      return {
        ad: { sourceUrl: input.url, ...node },
        warnings: [],
      };
    },
  };
}

export type __PROVIDER_FACTORY__Provider = ReturnType<typeof __PROVIDER_FACTORY__>;
