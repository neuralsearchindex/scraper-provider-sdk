# __CATALOG_ID__-catalog

**__CATALOG_NAME__** — a standalone scraper **catalog** built on
[`@neuralsearchindex/scraper-provider-sdk`](https://github.com/neuralsearchindex/scraper-provider-sdk).
It bundles several site providers (market `__CATALOG_MARKET__`, vertical `__CATALOG_BUSINESS_DOMAIN__`)
into one Docker image that joins the platform's **distributed catalog** over Redis/BullMQ — no
dependency on the central scraper app, no Postgres, no HTTP.

## How it works

1. On boot it **auto-discovers** every `src/providers/**/*.provider.ts` (awilix glob — no registry
   array) and **registers** each with the central catalog, stamped with this catalog's metadata
   (name, market, description) and the running image **version**.
2. It **consumes** each provider's `discover.<id>` / `scrape.<id>` BullMQ lanes.
3. The central **dispatches** discovery/scrape jobs; this worker runs the providers and **reports
   results back** (`saveDiscovered`, `saveScraped`, `completeRun`); the central persists them.
4. Stopping the worker drops its BullMQ presence, so the central de-registers this catalog
   automatically (it disappears from the admin gallery).

## Add a provider

Drop `src/providers/<id>/<id>.provider.ts` whose default export is a `() => SiteProvider` factory
(`export default function make<Id>Provider(): SiteProvider`). It is picked up automatically.

## Develop

```bash
pnpm install
cp .env.example .env            # point REDIS_URL at the shared Redis (mind the DB index, e.g. /1)
pnpm dev
```

## Docker / compose

```bash
docker compose up --build       # Valkey + this catalog worker (standalone)
```

For a full end-to-end (central scraper + admin), add this service to the scraper repo's
`docker-compose.yml`. The image is published to `ghcr.io/neuralsearchindex/__CATALOG_ID__-catalog`
on every `v*` release tag.
