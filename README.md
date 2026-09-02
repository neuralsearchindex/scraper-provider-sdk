# @neuralsearchindex/scraper-provider-sdk

Author **one scraper provider as its own standalone app** (its own repo / Docker image) that joins
the platform's **distributed catalog** over Redis/BullMQ — with no dependency on the central scraper
app, no Postgres, and no HTTP. Redis is the only connection a worker needs.

## What's in the box

- **Contract** (`contract.ts`) — the `SiteProvider` interface (identical to the central's), plus
  `matchesDomain` / `resolveStrategy`. A provider is ordinary data: an id, domains, a streaming
  `discover()`, and a deterministic `extractDetails()`.
- **Engine** (`engine.ts`) — a dependency-light deterministic toolkit: `fetchHtml`,
  `fetchSitemapEntries` / `fetchSitemapLocs`, `extractLinks`, `harvestJsonLd`. Enough to build a
  provider that needs **no headless browser and no LLM**, so the image stays tiny.
- **Runtime** (`runProviderWorker`) — registers the provider with the central catalog, consumes its
  `discover:<id>` / `scrape:<id>` lanes, runs the provider, and reports results back over BullMQ
  (`saveDiscovered` per batch, `saveScraped` per listing, `completeRun` at the end). The central
  persists. Presence-based: stopping the worker de-registers it automatically.
- **CLI** (`create-scraper-provider <id>`) — scaffolds a ready-to-run standalone provider app.

## Quick start

```bash
# scaffold a new provider app
npx @neuralsearchindex/scraper-provider-sdk create-scraper-provider superauto-pl
cd superauto-pl-provider && pnpm install
JOBS_REDIS_URL=redis://localhost:6379 pnpm dev
```

Then implement `discover()` + `extractDetails()` in `src/superauto-pl.provider.ts`.

## Wire contract

The SDK and the central scraper agree on BullMQ queue names + payloads in `wire.ts`
(`scraping/registerProvider`, `scraping/saveDiscovered`, `scraping/saveScraped`,
`scraping/completeRun`, and the `discover:<id>` / `scrape:<id>` lanes). Every job's `data` is the
`{ payload, meta }` envelope the central's JobsManager uses.

## Scripts

`pnpm build` · `pnpm test` · `pnpm types:check`
