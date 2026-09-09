import { defineCatalog } from "@neuralsearchindex/scraper-provider-sdk";

/**
 * __CATALOG_NAME__ — catalog manifest (metadata only).
 *
 * The providers themselves are NOT listed here: they are auto-discovered from
 * `src/providers/**​/*.provider.ts` by the SDK (awilix glob, no registry array). Drop a
 * `src/providers/<id>/<id>.provider.ts` whose default export is a `() => SiteProvider` factory and
 * it joins this catalog automatically. The catalog `version` is resolved at boot from the running
 * image (CATALOG_VERSION env, else this package.json) — do not hard-code it.
 */
export default defineCatalog({
  id: "__CATALOG_ID__",
  name: "__CATALOG_NAME__",
  market: "__CATALOG_MARKET__",
  businessDomain: "__CATALOG_BUSINESS_DOMAIN__",
  description: "__CATALOG_DESCRIPTION__",
});
