/**
 * Constants used by the scraper engine's browser + extraction code.
 */

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

/**
 * When true, image/media/font requests are aborted during scraping to speed up
 * navigation and cut bandwidth. Toggle with the BLOCK_MEDIA env var.
 */
export const BLOCK_MEDIA =
  (process.env.BLOCK_MEDIA ?? "false").toLowerCase() === "true";

/**
 * User-Agent applied to the plain-HTTP fetch path. A realistic desktop Chrome UA
 * by default; override with the SCRAPER_USER_AGENT env var.
 */
export const DEFAULT_USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/**
 * Remote browser endpoints exposed by the `playwright-vnc` service. The scraper
 * does not launch browsers itself — it attaches to that service (headed and
 * watchable over VNC) as its browser: Chromium over CDP, Camoufox over the
 * Playwright WebSocket server (Firefox is not CDP-attachable). Defaults use the
 * docker-compose service DNS name; override for host-run dev (localhost) or a
 * different deployment. Proxy / locale / timezone are configured on the SERVICE
 * (PLAYWRIGHT_VNC_*), since that is where the browsers actually launch.
 */
export const PLAYWRIGHT_VNC_CDP_URL =
  process.env.PLAYWRIGHT_VNC_CDP_URL || "http://playwright-vnc:9222";
export const PLAYWRIGHT_VNC_CAMOUFOX_WS =
  process.env.PLAYWRIGHT_VNC_CAMOUFOX_WS || "ws://playwright-vnc:9224/camoufox";
