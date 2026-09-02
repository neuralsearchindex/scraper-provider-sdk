// Playwright client only — the scraper does NOT launch browsers. It attaches to
// the `playwright-vnc` service and drives its remote browsers. `playwright-core`
// is a pure-JS client (no bundled browser binaries): `chromium.connectOverCDP`
// for the Chromium rungs, `firefox.connect` for the Camoufox (Firefox) rung.
import { lookup } from "node:dns/promises";
import { chromium, firefox } from "playwright-core";
import type {
  Browser,
  BrowserContext,
  Page,
  Response,
  Route,
  Request as PlaywrightRequest,
} from "playwright-core";
import { createLogger } from "./logger";
import {
  AD_SERVING_DOMAINS,
  BLOCK_MEDIA,
  PLAYWRIGHT_VNC_CAMOUFOX_WS,
  PLAYWRIGHT_VNC_CDP_URL,
} from "./constants";
import { type WaitUntilOption } from "./types";
import { CHALLENGE_MARKERS } from "./challenge";

/**
 * Shared browser wrapper used by the scrape orchestrator.
 *
 * The scraper is a **client** of the `playwright-vnc` service (headed browsers,
 * watchable over VNC) — it does not launch browsers in-process. It attaches to
 * the service's two remote endpoints and drives the pages itself; all the
 * page-level logic below (Cloudflare handling, Turnstile, screenshots, content
 * extraction) is transport-agnostic and works unchanged over the wire.
 *
 * ## Adaptive Cloudflare escalation
 *
 * Sites vary from "no protection" to "Cloudflare Turnstile". Rather than keep a
 * per-domain config, `loadPage` tries a ladder of browser backends fastest-first
 * and **escalates automatically** the moment it detects a Cloudflare block,
 * stopping at the first backend that gets through:
 *
 *  1. `camoufox` — Camoufox (hardened Firefox) on the service, via
 *     `firefox.connect`. Passes Turnstile reliably.
 *  2. `chromium:headed` — real Chrome on the service, via `connectOverCDP`. Last
 *     resort for sites Camoufox can't clear but headed Chrome can.
 *
 * (The unprotected-site fast path is the plain-HTTP `fetchHtml` in `scrape.ts`,
 * so there is no separate headless-Chromium rung here.)
 *
 * A per-host cache (`hostBackend`) remembers which backend last cleared a given
 * hostname, so repeat requests skip straight to it instead of re-escalating. The
 * cache still re-escalates if the cached backend later fails (expired clearance,
 * tightened site).
 *
 * The persistent profiles (so `cf_clearance` survives across requests/restarts)
 * live on the SERVICE. The scraper caches one remote connection per backend and
 * reuses it; each `loadPage` opens a fresh *page* in the shared remote context,
 * so ad/media blocking is registered per page.
 */

const log = createLogger({ name: "scraper-engine" });

/** Resource types aborted when media blocking is enabled. */
const BLOCKED_MEDIA_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** Opt-in escalation tracing (`SCRAPER_DEBUG=true`) for ops / debugging. */
const DEBUG = (process.env.SCRAPER_DEBUG ?? "").toLowerCase() === "true";
function debug(msg: string): void {
  if (DEBUG) log.debug(msg);
}

/**
 * Keep the remote browsing session warm across scrapes (`SCRAPER_KEEP_BROWSER_OPEN`,
 * default `true`). The remote Browser on playwright-vnc is always open; this
 * controls the CONTEXT:
 *  - `true`  — reuse one warm context per backend; each scrape only opens/closes a
 *    *tab*. Cookies + `cf_clearance` persist, so repeat scrapes of a host skip the
 *    Cloudflare challenge and are much faster. Tabs close, the browser stays open.
 *  - `false` — each scrape gets a throwaway context that is closed afterwards:
 *    fully isolated sessions (no shared cookies), but every scrape re-solves any
 *    challenge, so it is slower.
 */
const KEEP_BROWSER_OPEN =
  (process.env.SCRAPER_KEEP_BROWSER_OPEN ?? "true").toLowerCase() !== "false";

/** Backend identifiers, fastest → most capable. */
type Backend = "camoufox" | "chromium:headed";

/** The escalation ladder, in order. */
const LADDER: Backend[] = ["camoufox", "chromium:headed"];

/**
 * How long to wait, per backend, confirming a Cloudflare challenge before
 * escalating. Only spent on genuinely challenged pages — an unprotected page has
 * no challenge markers and resolves instantly.
 */
const DETECT_TIMEOUT = 15000;

/** Last backend that cleared Cloudflare for a hostname (in-memory, rebuilt cheaply). */
const hostBackend = new Map<string, Backend>();

/**
 * Global cap on concurrent page loads. Every `loadPage` drives a real browser
 * navigation on the shared persistent context; without a bound, a fanned-out
 * scrape can open dozens of pages at once — wasting memory and, by bursting a
 * single host, inviting bot detection. Override with `SCRAPER_MAX_CONCURRENCY`
 * (default 4). The semaphore bounds the distinct loads.
 */
const MAX_CONCURRENCY = (() => {
  const raw = Number.parseInt(process.env.SCRAPER_MAX_CONCURRENCY ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
})();

let activeLoads = 0;
const loadQueue: Array<() => void> = [];

/** Acquire a page-load slot, waiting FIFO if the concurrency cap is reached. */
function acquireLoadSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    const attempt = () => {
      if (activeLoads < MAX_CONCURRENCY) {
        activeLoads++;
        resolve();
      } else {
        loadQueue.push(attempt);
      }
    };
    attempt();
  });
}

/** Release a page-load slot and wake the next waiter, if any. */
function releaseLoadSlot(): void {
  activeLoads--;
  loadQueue.shift()?.();
}

/** Ladder for a hostname: cached winner first (still re-escalates if it fails). */
function backendsFor(hostname: string): Backend[] {
  const cached = hostname ? hostBackend.get(hostname) : undefined;
  if (!cached) return LADDER;
  return [cached, ...LADDER.filter((b) => b !== cached)];
}

/** A live remote connection: the attached Browser + the context we drive pages in. */
interface RemoteConn {
  browser: Browser;
  context: BrowserContext;
}

/** One lazy remote connection per backend id (reused across page loads). */
const conns = new Map<Backend, Promise<RemoteConn>>();

/**
 * Resolve the CDP endpoint's hostname to an IP address.
 *
 * Chrome's DevTools HTTP/WS endpoints reject any request whose `Host` header is
 * not `localhost` or an IP literal (a DNS-rebinding guard that can't be disabled
 * by flag). Cross-container we reach the service by its DNS name
 * (`playwright-vnc`), which Chrome rejects with a 500 — so resolve it to an IP and
 * connect to that. `localhost` / bare IPs pass through unchanged.
 */
async function resolveCdpEndpoint(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl);
  try {
    const { address } = await lookup(url.hostname, { family: 4 });
    url.hostname = address;
  } catch {
    // Fall back to the configured host (already an IP, or resolution unavailable).
  }
  return url.toString();
}

/**
 * Attach to the service's headed Chromium over CDP and reuse its existing
 * persistent context (the VNC-visible session that holds `cf_clearance`). We open
 * pages in that context; we never close it — the service owns its lifecycle.
 */
async function connectChromium(): Promise<RemoteConn> {
  const endpoint = await resolveCdpEndpoint(PLAYWRIGHT_VNC_CDP_URL);
  const browser = await chromium.connectOverCDP(endpoint);
  // The service prewarms a headed context, so `contexts()[0]` is normally present;
  // fall back to creating one if we attached before the prewarm landed.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return { browser, context };
}

/**
 * Attach to the service's headed Camoufox WebSocket server. Firefox is not
 * CDP-attachable, so the service runs it as a Playwright `launchServer`; we
 * connect and reuse its persistent context.
 */
async function connectCamoufox(): Promise<RemoteConn> {
  const browser = await firefox.connect(PLAYWRIGHT_VNC_CAMOUFOX_WS);
  // The launchServer browser exposes no default context, so we create one. It must
  // pass `viewport: null` — this Camoufox build rejects Playwright's default
  // `Browser.setDefaultViewport` call (a fixed viewport throws a protocol error).
  // The stealth fingerprint (geoip/humanize/…) is applied browser-wide at launch,
  // so contexts created here inherit it.
  const context =
    browser.contexts()[0] ?? (await browser.newContext({ viewport: null }));
  return { browser, context };
}

function connectBackend(backend: Backend): Promise<RemoteConn> {
  const conn = backend === "camoufox" ? connectCamoufox() : connectChromium();
  const evict = () => {
    if (conns.get(backend) === conn) conns.delete(backend);
  };
  // Drop the cached connection when the remote link drops — e.g. the service
  // restarts (Browser fires "disconnected") — so the next call reconnects. Also
  // evict if the connect itself rejects, so a transient failure isn't cached as a
  // permanently-rejected promise.
  void conn.then(({ browser }) => browser.once("disconnected", evict), evict);
  return conn;
}

function getConn(backend: Backend): Promise<RemoteConn> {
  let conn = conns.get(backend);
  if (!conn) {
    conn = connectBackend(backend);
    conns.set(backend, conn);
  }
  return conn;
}

/** The remote context for a backend, connecting (and caching) lazily. */
function getContext(backend: Backend): Promise<BrowserContext> {
  return getConn(backend).then((c) => c.context);
}

/**
 * A context to run a page load in, plus a `release` to call when the load is done.
 *
 * Honours {@link KEEP_BROWSER_OPEN}: when set (default) we hand back the backend's
 * warm, cached context and `release` is a no-op — only the *page* (tab) is torn
 * down by the caller, so cookies / `cf_clearance` persist. When cleared, we hand
 * back a throwaway context that `release` closes, isolating each scrape. Either
 * way the Browser connection stays open (closing the remote browser is the
 * service's job, not ours).
 */
async function acquireContext(
  backend: Backend
): Promise<{ context: BrowserContext; release: () => Promise<void> }> {
  const { browser, context } = await getConn(backend);
  if (KEEP_BROWSER_OPEN) {
    return { context, release: async () => {} };
  }
  const fresh =
    backend === "camoufox"
      ? await browser.newContext({ viewport: null })
      : await browser.newContext();
  return { context: fresh, release: () => fresh.close().catch(() => {}) };
}

/** Callback run against the loaded page. */
export type PageEvaluate<T> = (
  page: Page,
  response: Response | null
) => Promise<T>;

export interface LoadPageOptions<T> {
  /** When to consider navigation complete (default: domcontentloaded). */
  waitUntil?: WaitUntilOption;
  /** Navigation timeout in ms (default: 30000). */
  timeout?: number;
  /** Extra HTTP headers sent with requests from this page. */
  extraHTTPHeaders?: Record<string, string>;
  /** Abort image/media/font requests (default: BLOCK_MEDIA env var). */
  blockMedia?: boolean;
  /** Abort requests to known ad/tracking domains (default: true). */
  blockAds?: boolean;
  /** Runs against the loaded page; its return value is returned by loadPage. */
  evaluate: PageEvaluate<T>;
}

/** Register per-page ad/media request blocking. */
async function applyRequestBlocking(
  page: Page,
  blockAds: boolean,
  blockMedia: boolean
): Promise<void> {
  await page.route("**/*", (route: Route, request: PlaywrightRequest) => {
    let hostname = "";
    try {
      hostname = new URL(request.url()).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
    // Never block Cloudflare's own challenge assets — aborting them would stop
    // Turnstile from solving and the page would loop on the interstitial.
    const isCloudflareChallenge =
      hostname.endsWith("cloudflare.com") ||
      request.url().includes("/cdn-cgi/");
    if (isCloudflareChallenge) return route.continue();

    if (
      blockMedia &&
      BLOCKED_MEDIA_RESOURCE_TYPES.has(request.resourceType())
    ) {
      return route.abort();
    }
    if (
      blockAds &&
      AD_SERVING_DOMAINS.some((domain) => hostname.includes(domain))
    ) {
      return route.abort();
    }
    return route.continue();
  });
}

/**
 * Load `url`, escalating browser backends until Cloudflare is cleared, run
 * `evaluate` against the loaded page, and return its result. The winning backend
 * is cached per host. The page is always torn down afterwards; contexts (and
 * their profiles) are left running so clearance is reused by the next call.
 */
export async function loadPage<T>(
  url: string,
  options: LoadPageOptions<T>
): Promise<T> {
  const {
    waitUntil = "domcontentloaded",
    timeout = 30000,
    extraHTTPHeaders,
    blockMedia = BLOCK_MEDIA,
    blockAds = true,
    evaluate,
  } = options;

  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  // Bound how many page loads run at once (see MAX_CONCURRENCY). Held across
  // Cloudflare escalation since that whole span is using the browser.
  await acquireLoadSlot();
  try {
    const backends = backendsFor(hostname);
    for (let i = 0; i < backends.length; i++) {
      const backend = backends[i];
      const isLast = i === backends.length - 1;
      let page: Page | undefined;
      let release: () => Promise<void> = async () => {};
      try {
        // Inside the try so a connect failure (e.g. the service or this rung being
        // unavailable) also escalates to the next backend instead of throwing out
        // of loadPage.
        const acquired = await acquireContext(backend);
        release = acquired.release;
        page = await acquired.context.newPage();
        if (extraHTTPHeaders) await page.setExtraHTTPHeaders(extraHTTPHeaders);
        if (blockAds || blockMedia) {
          await applyRequestBlocking(page, blockAds, blockMedia);
        }

        const response = await page.goto(url, { waitUntil, timeout });
        await solveTurnstile(page);
        const blocked = await isBlockedByCloudflare(page, DETECT_TIMEOUT);

        if (blocked && !isLast) {
          debug(`${hostname}: ${backend} blocked by Cloudflare, escalating`);
          continue; // finally closes the page (and throwaway context)
        }

        // Cleared, or this is the last backend (best-effort return either way).
        if (!blocked && hostname) {
          hostBackend.set(hostname, backend);
          debug(`${hostname}: cleared on ${backend}`);
        } else if (blocked) {
          debug(
            `${hostname}: still blocked on last backend ${backend}, returning best-effort`
          );
        }
        return await evaluate(page, response);
      } catch (err) {
        // A navigation/eval failure escalates like a block, unless we're out of
        // backends — then surface the error to the caller.
        if (isLast) throw err;
        debug(
          `${hostname}: ${backend} errored (${(err as Error).message?.split("\n")[0]}), escalating`
        );
      } finally {
        // Always close the tab; `release` closes the throwaway context when
        // SCRAPER_KEEP_BROWSER_OPEN is off (a no-op when the context is reused).
        if (page && !page.isClosed()) await page.close();
        await release();
      }
    }

    // Unreachable: the last backend always returns or throws above.
    throw new Error(`loadPage: exhausted all backends for ${url}`);
  } finally {
    releaseLoadSlot();
  }
}

/** A live page opened via the escalation ladder. Caller owns `page.close()`. */
export interface OpenPageResult {
  page: Page;
  context: BrowserContext;
  backend: Backend;
  response: Response | null;
}

/**
 * Like {@link loadPage}, but hands back a **live** page — no `evaluate`, no
 * teardown. Runs the same fastest-first backend ladder and Cloudflare handling,
 * stopping at the first backend that clears the page (or the last, best-effort).
 *
 * The concurrency slot is held **only across navigation/escalation**, then
 * released before returning: a page then sits idle WITHOUT occupying a load slot.
 * The caller is responsible for eventually calling `page.close()`.
 */
export async function openPageOnLadder(
  url: string,
  options: {
    waitUntil?: WaitUntilOption;
    timeout?: number;
    extraHTTPHeaders?: Record<string, string>;
    blockMedia?: boolean;
    blockAds?: boolean;
  } = {}
): Promise<OpenPageResult> {
  const {
    waitUntil = "domcontentloaded",
    timeout = 30000,
    extraHTTPHeaders,
    blockMedia = BLOCK_MEDIA,
    blockAds = true,
  } = options;

  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  await acquireLoadSlot();
  try {
    const backends = backendsFor(hostname);
    for (let i = 0; i < backends.length; i++) {
      const backend = backends[i];
      const isLast = i === backends.length - 1;
      let page: Page | undefined;
      try {
        const context = await getContext(backend);
        page = await context.newPage();
        if (extraHTTPHeaders) await page.setExtraHTTPHeaders(extraHTTPHeaders);
        if (blockAds || blockMedia) {
          await applyRequestBlocking(page, blockAds, blockMedia);
        }

        const response = await page.goto(url, { waitUntil, timeout });
        await solveTurnstile(page);
        const blocked = await isBlockedByCloudflare(page, DETECT_TIMEOUT);

        if (blocked && !isLast) {
          debug(`${hostname}: ${backend} blocked by Cloudflare, escalating`);
          await page.close().catch(() => {});
          continue;
        }

        if (!blocked && hostname) {
          hostBackend.set(hostname, backend);
          debug(`${hostname}: cleared on ${backend}`);
        } else if (blocked) {
          debug(
            `${hostname}: still blocked on last backend ${backend}, returning best-effort`
          );
        }
        // Hand the LIVE page back — unlike loadPage, we do NOT close it here.
        return { page, context, backend, response };
      } catch (err) {
        // On a navigation/launch failure, close the doomed page and escalate,
        // unless we're out of backends — then surface the error.
        if (page && !page.isClosed()) await page.close().catch(() => {});
        if (isLast) throw err;
        debug(
          `${hostname}: ${backend} errored (${(err as Error).message?.split("\n")[0]}), escalating`
        );
      }
    }

    // Unreachable: the last backend always returns or throws above.
    throw new Error(`openPageOnLadder: exhausted all backends for ${url}`);
  } finally {
    releaseLoadSlot();
  }
}

/**
 * Best-effort: if an interactive Turnstile checkbox is present, click it. Managed
 * / non-interactive Turnstile auto-passes with no widget, so this is a no-op
 * there. Wrapped so a miss never breaks the load; `disable_coop` on the Camoufox
 * backend is what makes the cross-origin iframe clickable.
 */
export async function solveTurnstile(page: Page): Promise<void> {
  try {
    const frame = page
      .frames()
      .find((f) => f.url().includes("challenges.cloudflare.com"));
    if (!frame) return;
    const box = await page
      .locator('iframe[src*="challenges.cloudflare.com"]')
      .first()
      .boundingBox()
      .catch(() => null);
    if (box) {
      // The checkbox sits near the left edge, vertically centered.
      await page.mouse.click(box.x + 30, box.y + box.height / 2);
    }
  } catch {
    // Best-effort — auto-pass challenges need no click.
  }
}

// The shared Cloudflare interstitial markers live in the dependency-free
// `./challenge.js` module so the plain-HTTP fetch path can reuse the same
// detection without importing the browser engine. Re-exported here for callers.
export { CHALLENGE_MARKERS } from "./challenge";

/**
 * Positive detection of a Cloudflare block: resolves `false` as soon as no
 * challenge markers are present (an unprotected page never had any, so this is
 * instant), or `true` if the challenge is still up after `timeout`. Positive
 * detection — never "no content yet" — so a merely-slow legit page doesn't
 * trigger a false escalation.
 */
export async function isBlockedByCloudflare(
  page: Page,
  timeout = DETECT_TIMEOUT
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (markersSource: string) => {
        const markers = new RegExp(markersSource);
        // `textContent`, not `innerText`: headless Firefox (Camoufox) returns an
        // empty `innerText` (it's layout-dependent), which would hide the markers.
        const text = (
          document.title +
          " " +
          (document.body?.textContent || "")
        ).toLowerCase();
        const onChallenge =
          location.pathname.includes("cf-challenge") ||
          markers.test(text) ||
          !!document.querySelector('[name="cf-turnstile-response"]');
        return !onChallenge;
      },
      CHALLENGE_MARKERS.source,
      { timeout, polling: 500 }
    );
    return false; // cleared, or never challenged
  } catch {
    return true; // still on the challenge after timeout → blocked
  }
}

/** How long the DOM size must hold steady to count as "finished rendering". */
const DOM_STABLE_MS = 1200;

/**
 * Block until the page is actually ready to scrape: any Cloudflare interstitial
 * has cleared AND the document has stopped rendering. Both waits matter for a
 * JS-rendered site behind Cloudflare — the challenge redirect leaves a shell
 * (all scripts/SVG, no real text) for a beat, then the content streams in a few
 * seconds later, so reading the DOM too early yields nothing to convert.
 *
 * Readiness is content-agnostic: rather than a fixed text-length threshold (which
 * can't serve both a tiny static page and a lazy SPA), it waits for `innerHTML`
 * to stop growing for {@link DOM_STABLE_MS}. Returns `true` when ready, `false`
 * if the challenge never cleared (best-effort: the caller proceeds regardless).
 */
export async function waitForChallengeToClear(
  page: Page,
  timeout = 30000
): Promise<boolean> {
  const deadline = Date.now() + timeout;

  // Phase 1: wait out any Cloudflare interstitial (textContent — see note above).
  const cleared = await page
    .waitForFunction(
      (markersSource: string) => {
        const markers = new RegExp(markersSource);
        const text = (
          document.title +
          " " +
          (document.body?.textContent || "")
        ).toLowerCase();
        return !(
          location.pathname.includes("cf-challenge") || markers.test(text)
        );
      },
      CHALLENGE_MARKERS.source,
      { timeout }
    )
    .then(() => true)
    .catch(() => false);
  if (!cleared) return false;

  // Phase 2: wait for the DOM to stop growing (client render settled).
  let lastLen = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const len = await page
      .evaluate(() => document.body?.innerHTML?.length ?? 0)
      .catch(() => -1);
    if (len === lastLen) {
      if (Date.now() - stableSince >= DOM_STABLE_MS) return true;
    } else {
      lastLen = len;
      stableSince = Date.now();
    }
    await page.waitForTimeout(300);
  }
  return true; // best-effort at timeout
}

export interface CaptureScreenshotOptions {
  waitUntil?: WaitUntilOption;
  timeout?: number;
  extraHTTPHeaders?: Record<string, string>;
  /** Wait out any Cloudflare interstitial + DOM settle before shooting (default true). */
  waitForRender?: boolean;
}

/**
 * Load `url` on the escalation ladder and capture a full-page PNG, returned as a
 * `data:image/png;base64,…` URI. Media is NOT blocked (a screenshot needs images
 * to render). Uses {@link loadPage} so it inherits Cloudflare escalation.
 */
export async function captureScreenshot(
  url: string,
  options: CaptureScreenshotOptions = {}
): Promise<string> {
  const {
    waitUntil = "networkidle",
    timeout = 30000,
    extraHTTPHeaders,
    waitForRender = true,
  } = options;

  return loadPage<string>(url, {
    waitUntil,
    timeout,
    extraHTTPHeaders,
    blockMedia: false,
    async evaluate(page) {
      if (waitForRender) await waitForChallengeToClear(page);
      const buffer = await page.screenshot({ fullPage: true, type: "png" });
      return `data:image/png;base64,${buffer.toString("base64")}`;
    },
  });
}

/**
 * Drop all cached remote connections. Call on process shutdown.
 *
 * We deliberately do NOT close the remote browsers/contexts — they belong to the
 * `playwright-vnc` service (persistent, VNC-visible, shared) and closing them
 * would tear down the service's session. The client-side sockets close when this
 * process exits, which the service handles as an ordinary disconnect.
 */
export async function closeBrowser(): Promise<void> {
  conns.clear();
}

// Drop cached connections when the host process exits (the sockets close with it).
let shutdownRegistered = false;
if (!shutdownRegistered) {
  shutdownRegistered = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void closeBrowser().finally(() => process.exit(0));
    });
  }
  process.once("exit", () => {
    void closeBrowser();
  });
}
