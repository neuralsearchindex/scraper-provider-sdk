// MUST be the first import. Sentry instruments modules (http, undici) as they
// are loaded and ES imports are hoisted, so an init call placed lower down —
// or inside runCatalogWorker, which also initialises as a fallback — runs
// after the module graph is already built and cannot patch anything. Errors
// still get reported either way; only the automatic breadcrumbs and spans go
// quietly missing, which looks like "tracing doesn't work" rather than a bug.
//
// A no-op unless SENTRY_DSN is set, so local runs are unaffected.
import "@neuralsearchindex/scraper-provider-sdk/errors/register";

import path from "node:path";

import { runCatalogWorker } from "@neuralsearchindex/scraper-provider-sdk";

import catalog from "./catalog";

/**
 * Standalone catalog entrypoint. Auto-discovers every provider under `providers/`, connects to the
 * shared Redis, registers each provider (stamped with this catalog's metadata + running version),
 * and consumes their `discover.<id>` / `scrape.<id>` lanes.
 */
void runCatalogWorker(catalog, {
  // Resolves to src/ under tsx (dev) and lib/ after tsc (prod) — the same trick the scraper's DI uses.
  providersGlob: path.join(__dirname, "providers/**/*.provider.{js,ts}"),
  // Prefer REDIS_URL; fall back to the platform's shared JOBS_REDIS_URL (Helm sets that one).
  redisUrl: process.env.REDIS_URL ?? process.env.JOBS_REDIS_URL ?? "redis://localhost:6379",
  concurrency: Number(process.env.CONCURRENCY ?? 4),
  // For JS-heavy sites: set REMOTE_BROWSER_CDP_URL to a remote browser (e.g. playwright-vnc),
  // add `playwright-core`, and give the provider `detailFetchEngine: "browser"`.
  browser: process.env.REMOTE_BROWSER_CDP_URL ? { cdpUrl: process.env.REMOTE_BROWSER_CDP_URL } : undefined,
});
