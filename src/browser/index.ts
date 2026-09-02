/**
 * Shared browser engine — the SAME implementation the central scraper uses (camoufox + chromium
 * over CDP, Cloudflare challenge clearing, per-host backend caching). Imported via the
 * `@neuralsearchindex/scraper-provider-sdk/browser` subpath so it (and its `playwright-core`
 * optional peer) never load for deterministic, fetch-only providers.
 */
export * from "./browser";
export { textLooksLikeChallenge } from "./challenge";
export { WAIT_UNTIL_OPTIONS, type WaitUntilOption } from "./types";
