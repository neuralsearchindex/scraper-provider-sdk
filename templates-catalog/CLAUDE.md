# __CATALOG_NAME__ (`__CATALOG_ID__-catalog`)

A standalone **scraper catalog** built on
[`@neuralsearchindex/scraper-provider-sdk`](https://github.com/neuralsearchindex/scraper-provider-sdk).
It bundles the providers for **market `__CATALOG_MARKET__`, vertical `__CATALOG_BUSINESS_DOMAIN__`**
into one Docker image that runs as a Redis-only BullMQ worker: it registers its providers with the
central scraper over `JOBS_REDIS_URL`/`REDIS_URL`, then consumes each provider's
`discover.<id>` / `scrape.<id>` lanes. No HTTP, no Postgres — Redis is the only dependency.

## Layout

- `src/catalog.ts` — the catalog **manifest** (metadata only: id, name, market, vertical). Providers
  are NOT listed here.
- `src/providers/<id>/<id>.provider.ts` — one provider per site. **Auto-discovered** by the SDK via
  awilix glob (no registry array): drop the file and it joins the catalog. Its default export must be
  a factory `() => SiteProvider`; colocate a `<id>.provider.test.ts`.
- `src/index.ts` — the entrypoint (`runCatalogWorker`). Rarely edited.

## A provider (`SiteProvider`)

```ts
import type { SiteProvider } from "@neuralsearchindex/scraper-provider-sdk";
export default function make<Id>Provider(): SiteProvider {
  return {
    id: "<brand>-<tld>",              // matches the folder/file name
    domains: ["example.com"],         // hostnames this provider claims
    businessDomain: "__CATALOG_BUSINESS_DOMAIN__",
    tier: "agency",                   // "agency" (direct/original) | "portal" (big aggregator)
    async *discover(seedUrl, opts) { /* yield { listings, cursor? } */ },
    async extractDetails({ html, url }) { /* → { ad, images?, warnings } */ },
  };
}
```

- **`tier`** — `agency` = a single dealer's/agency's own site (small, stable). `portal` = a large
  aggregator (otodom/otomoto/immoscout24 — more coverage, more likely to bot-wall). An operator can
  deploy only `agency` providers via `CATALOG_TIERS` and hold back the portals.
- **`discover()`** streams `{ listings, cursor? }` batches (resumable). Cheapest structured source
  first: RSS → sitemap → JSON API → `__NEXT_DATA__` → list-page scrape.
- **`extractDetails()`** maps one detail page to a structured ad. Vehicles: `schemaOrgVehicleDetails()`
  or map to a `VehicleAd`. Real estate: `facetsToDetails(...)` over `@…/parse` helpers
  (`schemaOrgPropertyFacets`, `immomigDetails`, `html-facets`). Browser-gated sites: set
  `detailFetchEngine: "browser"` and run against the bundled `playwright-vnc`.

## Add a provider / test

- **Add a provider:** follow `.claude/skills/add-provider/SKILL.md`.
- **Test:** follow `.claude/skills/test-catalog/SKILL.md` (`pnpm test` runs colocated `node:test`
  files; `docker compose up` runs a full local worker + Valkey + playwright-vnc). CI (`.github/workflows/test.yml`)
  runs types-check + tests + build on every push/PR.

> Gotcha: the worker's `REDIS_URL` must use the SAME Redis DB index the central scraper's
> `JOBS_REDIS_URL` uses (`/1`) — a different index silently isolates registration.
