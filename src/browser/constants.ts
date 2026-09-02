/** Browser-engine constants (ported from the scraper so both share one implementation). */
export const AD_SERVING_DOMAINS = [
  "doubleclick.net",
  "adservice.google.com",
  "googlesyndication.com",
  "googletagservices.com",
  "googletagmanager.com",
  "google-analytics.com",
  "adsystem.com",
  "adservice.com",
  "adnxs.com",
  "ads-twitter.com",
  "facebook.net",
  "fbcdn.net",
  "amazon-adsystem.com",
];

/** Abort image/media/font requests during scraping. Toggle with BLOCK_MEDIA. */
export const BLOCK_MEDIA = (process.env.BLOCK_MEDIA ?? "false").toLowerCase() === "true";

/**
 * Remote browser endpoints of the `playwright-vnc` service. Same env var names as the central
 * scraper, so a worker sharing that service needs no extra config.
 */
export const PLAYWRIGHT_VNC_CDP_URL =
  process.env.PLAYWRIGHT_VNC_CDP_URL || "http://playwright-vnc:9222";
export const PLAYWRIGHT_VNC_CAMOUFOX_WS =
  process.env.PLAYWRIGHT_VNC_CAMOUFOX_WS || "ws://playwright-vnc:9224/camoufox";
