/**
 * Shared types for the Playwright-based scraping engine.
 */

/** Values accepted by Playwright's `waitUntil` navigation option. */
export const WAIT_UNTIL_OPTIONS = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
] as const;

/** When to consider a Playwright navigation complete. */
export type WaitUntilOption = (typeof WAIT_UNTIL_OPTIONS)[number];
