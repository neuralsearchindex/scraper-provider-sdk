---
name: test-catalog
description: Test this scraper catalog — unit tests (node:test on fixtures), types-check, build, and a full local end-to-end run of the worker against Valkey + playwright-vnc via docker compose. Use when asked to test the catalog, a provider, verify discovery/scraping works, or debug a provider locally.
---

# Test `__CATALOG_ID__-catalog`

## Fast checks (no network, no Docker)

```bash
pnpm install
pnpm types:check     # tsc --noEmit
pnpm test            # node:test over src/**/*.test.ts (fixtures only — never the live site)
pnpm build           # tsc → lib/
```

Provider unit tests must run against **fixtures** (`__fixtures__/*.html|json`), not the live site.
Test the exported pure helpers (URL builders, parsers, `resolveLanguage`, `mapDetailTo*`).

## Full local end-to-end (docker compose)

`docker-compose.yml` brings up **Valkey + playwright-vnc + this catalog worker**:

```bash
docker compose up --build
```

- The worker registers its providers (respecting `CATALOG_TIERS`) and consumes their
  `discover.<id>` / `scrape.<id>` lanes. Watch the logs for `registered <id> …`.
- **Redis DB `/1`**: `REDIS_URL` must use the SAME DB index the central scraper's `JOBS_REDIS_URL`
  uses. The bundled compose already sets `redis://valkey:6379/1`.
- `playwright-vnc` is bundled so `detailFetchEngine: "browser"` / browser-fetched sitemaps work.

Drive a real discover→scrape without the central by enqueuing onto the lanes and reading the result
sinks (all queues live in Redis DB `/1`):

```js
// inside the worker container (bullmq + the SDK wire are on its node path):
const { Queue } = require("bullmq");
const { envelope, discoverLane, scrapeLane, QUEUE_SAVE_DISCOVERED, QUEUE_SAVE_SCRAPED } =
  require("@neuralsearchindex/scraper-provider-sdk/lib/wire.js"); // or the /wire subpath
const connection = { host: "valkey", port: 6379, db: 1, maxRetriesPerRequest: null };
// enqueue a discover for one provider:
await new Queue(discoverLane("<id>"), { connection }).add("discover",
  envelope({ runId: "t1", providerId: "<id>", domain: "__CATALOG_BUSINESS_DOMAIN__", seedUrl: "https://<host>", limit: 3 }));
// then read bull:scraping/saveDiscovered:wait (redis-cli -n 1) to see discovered listings,
// enqueue scrapeLane("<id>") with one url, and read bull:scraping/saveScraped:wait for the ad.
```

For a **full-stack** e2e (central scraper + admin + Postgres), add this worker as a service to the
scraper repo's `docker-compose.yml` instead, and hit `GET /catalogs` on the central.

## CI

`.github/workflows/test.yml` runs types-check + tests + build on every push/PR. Keep it green.
