/** Values accepted by Playwright's `waitUntil` navigation option. */
export const WAIT_UNTIL_OPTIONS = ["load", "domcontentloaded", "networkidle", "commit"] as const;
export type WaitUntilOption = (typeof WAIT_UNTIL_OPTIONS)[number];
