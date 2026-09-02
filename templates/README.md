# __PROVIDER_ID__-provider

A **standalone scraper provider** for `__PROVIDER_ID__`, built on
[`@neuralsearchindex/scraper-provider-sdk`](https://github.com/neuralsearchindex/scraper-provider-sdk).
It ships as its own Docker image and joins the platform's **distributed catalog** over Redis/BullMQ —
no dependency on the central scraper app, no Postgres, no HTTP.

## How it works

1. On boot it **registers** `__PROVIDER_ID__` with the central catalog (a `kind=remote` row).
2. It **consumes** its `discover:__PROVIDER_ID__` / `scrape:__PROVIDER_ID__` BullMQ lanes.
3. The central **dispatches** discovery/scrape jobs; this worker runs the provider and **reports
   results back** over BullMQ (`saveDiscovered`, `saveScraped`, `completeRun`); the central persists.
4. Stopping the worker drops its BullMQ presence, so the central de-registers it automatically.

## Develop

```bash
pnpm install
cp .env.example .env            # point REDIS_URL at the shared Redis
REDIS_URL=redis://localhost:6379 pnpm dev
```

Implement the two hooks in `src/__PROVIDER_ID__.provider.ts`:
- `discover()` — yield batches of listing URLs (prefer a sitemap/RSS/JSON API over a crawl).
- `extractDetails()` — deterministically map a detail page to a structured ad (JSON-LD/meta/JSON).

Keep parsing logic in pure exported helpers and unit-test them (`pnpm test`).

### JS-heavy sites (remote browser)

The default engine is plain HTTP (tiny image, no browser). If your site needs JavaScript to render:

1. `pnpm add playwright-core`
2. Set `REMOTE_BROWSER_CDP_URL` to a running remote browser (e.g. the platform's `playwright-vnc`).
3. Give the provider `detailFetchEngine: "browser"` — detail pages are then rendered over CDP
   before `extractDetails()` runs. (Use `fetchRendered` from the SDK inside `discover()` too if the
   listing index itself needs rendering.)

## Deploy

```bash
docker build -t __PROVIDER_ID__-provider .
docker run -e REDIS_URL=redis://valkey:6379/1 __PROVIDER_ID__-provider
```

Run multiple replicas to scale — they're competing consumers on the same lanes.
