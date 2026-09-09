/**
 * A **catalog** is a named, described group of providers shipped and versioned as ONE standalone
 * app / Docker image (e.g. "Polish Car Deals", "Swiss Real Estate"). It is the unit an operator
 * enables/deploys and the "plugin" the admin shows as a card → drill into its scrapers.
 *
 * The manifest carries ONLY metadata. The providers themselves are auto-discovered from the app's
 * `src/providers/**​/*.provider.ts` via {@link loadProvidersFromDi} (awilix glob, no registry
 * array) — the same drop-a-file model the central scraper uses. The catalog's `version` is NOT
 * authored here: {@link runCatalogWorker} resolves it at boot from the running image
 * (`CATALOG_VERSION` env, else the baked `package.json`), so the advertised version is exactly the
 * image that is running.
 */

import type { BusinessDomain } from "./contract";

export interface CatalogManifest {
  /** Kebab id, `<market>-<vertical>` — e.g. "polish-vehicles". Also the default image/queue prefix. */
  id: string;
  /** Human name shown on the admin card — e.g. "Polish Car Deals". */
  name: string;
  /** One-paragraph blurb shown on the admin card. */
  description: string;
  /** ISO-3166 alpha-2 market, or "INT" for multi-country — e.g. "PL" | "CH" | "INT". */
  market: string;
  /** Dominant vertical; each provider may still override via its own `businessDomain`. */
  businessDomain?: BusinessDomain;
}

/** Identity helper so a catalog repo declares its manifest with type-checking. */
export function defineCatalog(manifest: CatalogManifest): CatalogManifest {
  return manifest;
}
