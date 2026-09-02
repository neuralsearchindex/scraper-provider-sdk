import { runProviderWorker } from "@neuralsearchindex/scraper-provider-sdk";

import __PROVIDER_FACTORY__ from "./__PROVIDER_ID__.provider";

/**
 * Standalone worker entrypoint. Connects to the shared Redis, registers this provider with the
 * central catalog, and consumes its `discover:__PROVIDER_ID__` / `scrape:__PROVIDER_ID__` lanes.
 */
void runProviderWorker({
  providers: [__PROVIDER_FACTORY__()],
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  concurrency: Number(process.env.CONCURRENCY ?? 4),
  // For JS-heavy sites: set REMOTE_BROWSER_CDP_URL to a remote browser (e.g. playwright-vnc),
  // add `playwright-core`, and give the provider `detailFetchEngine: "browser"`.
  browser: process.env.REMOTE_BROWSER_CDP_URL
    ? { cdpUrl: process.env.REMOTE_BROWSER_CDP_URL }
    : undefined,
});
