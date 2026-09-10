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

## Errors

Failures are reported to the platform's **GlitchTip** automatically — you do
not need to add anything per provider. `runCatalogWorker` initialises the SDK,
and every `discover.<id>` / `scrape.<id>` lane failure is captured with the
`provider`, `lane` and `catalog` tags.

Issues are grouped by **provider and lane**, not by listing URL. A portal that
changes its markup breaks every listing it has; that is one issue to fix, not
ten thousand to scroll past. The failing URL is on the issue as context.

Reporting is OFF unless `SENTRY_DSN` is set, so local runs never reach the
production stream. Do not set it in `.env` — Helm injects the right per-catalog
DSN in the cluster.

To attach extra context to a failure you are handling yourself:

```ts
import { captureCatalogError } from "@neuralsearchindex/scraper-provider-sdk";

catch (err) {
  captureCatalogError(err, { provider: "otodom-pl", lane: "scrape", url });
  throw err;   // still rethrow — BullMQ needs it to retry
}
```

A caught-and-swallowed error is invisible to both BullMQ and GlitchTip. If a
provider legitimately tolerates a failure, capture it explicitly rather than
letting it disappear: a catalog serves no HTTP and has no liveness probe, so
"quietly producing nothing" is its normal failure appearance.

