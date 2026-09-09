import { Queue, Worker, type Job } from "bullmq";
import * as cheerio from "cheerio";
import IORedis from "ioredis";

import type { CatalogManifest } from "./catalog";
import type { SiteProvider } from "./contract";
import { loadProvidersFromDi } from "./di";
import { htmlToMarkdown } from "./engine/markdown";
import { fetchHtml } from "./net";
import {
  QUEUE_COMPLETE_RUN,
  QUEUE_REGISTER_PROVIDER,
  QUEUE_SAVE_DISCOVERED,
  QUEUE_SAVE_SCRAPED,
  discoverLane,
  envelope,
  scrapeLane,
  type CompleteRunPayload,
  type DiscoverLanePayload,
  type JobEnvelope,
  type RegisterCatalogMeta,
  type RegisterProviderPayload,
  type SaveDiscoveredPayload,
  type SaveScrapedPayload,
  type ScrapeLanePayload,
} from "./wire";

export interface RunProviderWorkerOptions {
  /** The provider(s) this worker owns (ordinary SiteProviders — zero distributed awareness). */
  providers: SiteProvider[];
  /** Shared BullMQ Redis URL (the only connection the worker needs). */
  redisUrl: string;
  /** Per-lane concurrency (default 4). */
  concurrency?: number;
  /**
   * Optional REMOTE browser for JS-heavy sites. When set, providers whose
   * `detailFetchEngine === "browser"` render detail pages via the shared browser engine (the SAME
   * camoufox+chromium/CDP + Cloudflare-clearing engine the central scraper uses) instead of plain
   * fetch. Requires the optional peer dependency `playwright-core`. Endpoints come from
   * `cdpUrl`/`camoufoxWs` (or the `PLAYWRIGHT_VNC_CDP_URL`/`PLAYWRIGHT_VNC_CAMOUFOX_WS` env). Omit for
   * deterministic providers — they stay browserless and tiny.
   */
  browser?: {
    cdpUrl?: string;
    camoufoxWs?: string;
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  };
  /** Optional structured logger; defaults to console. */
  logger?: Pick<Console, "info" | "warn" | "error">;
  /**
   * Catalog metadata to advertise with every provider (set by {@link runCatalogWorker}). Omit for a
   * bare single-provider worker — the central then files the provider under the "built-in" group.
   */
  catalog?: RegisterCatalogMeta | null;
}

export interface RunningProviderWorker {
  /** Gracefully drain + close (closing consumers drops BullMQ presence → central de-registers). */
  stop(): Promise<void>;
}

/**
 * Boot a standalone provider worker: register the provider(s) with the central catalog, then consume
 * the per-provider `discover:<id>` / `scrape:<id>` lanes — running the real provider code and
 * reporting results back over BullMQ (`saveDiscovered` per batch, `saveScraped` per listing,
 * `completeRun` at the end). No HTTP, no Postgres; Redis is the only dependency.
 */
/**
 * Render a listing's embeddable `pageContent` Markdown the way the central in-process path does.
 * Precedence: a `pageContent` the provider baked into its ad → the provider's `pageContent()` hook →
 * a cleaned-HTML Markdown render (scoped to `contentSelector` when the provider sets one).
 */
async function resolvePageContent(
  provider: SiteProvider,
  input: { html: string; url: string; adPageContent?: string },
): Promise<string | null> {
  if (typeof input.adPageContent === "string" && input.adPageContent.trim()) return input.adPageContent;
  if (provider.pageContent) {
    const custom = await provider.pageContent({ html: input.html, fullHtml: input.html, url: input.url });
    if (custom && custom.trim()) return custom;
  }
  let html = input.html;
  if (provider.contentSelector) {
    try {
      const $ = cheerio.load(input.html);
      const scoped = $(provider.contentSelector).html();
      if (scoped) html = scoped;
    } catch {
      /* fall back to the full document */
    }
  }
  const md = htmlToMarkdown(html);
  return md.trim() ? md : null;
}

/** A provider's effective tier (default `agent` — most providers are direct sources). */
const tierOf = (p: SiteProvider): "agency" | "portal" => p.tier ?? "agency";

/**
 * The tiers this worker should run, from `CATALOG_TIERS` (CSV of `agent,portal`). Empty/unset → all.
 * Lets an operator deploy only `agent` providers and hold back the portals.
 */
function enabledTiers(): Set<"agency" | "portal"> | null {
  const raw = (process.env.CATALOG_TIERS ?? "").trim();
  if (!raw) return null; // all tiers
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is "agency" | "portal" => s === "agency" || s === "portal"),
  );
  return set.size > 0 ? set : null;
}

export async function runProviderWorker(opts: RunProviderWorkerOptions): Promise<RunningProviderWorker> {
  const log = opts.logger ?? console;
  const concurrency = opts.concurrency ?? 4;
  // Filter by the deployment's enabled tiers (CATALOG_TIERS) before doing anything else.
  const tiers = enabledTiers();
  const providers = tiers ? opts.providers.filter((p) => tiers.has(tierOf(p))) : opts.providers;
  if (tiers) {
    const held = opts.providers.filter((p) => !tiers.has(tierOf(p))).map((p) => p.id);
    log.info(`[provider-worker] CATALOG_TIERS=${[...tiers].join(",")} → running ${providers.length}/${opts.providers.length}` + (held.length ? `; holding back ${held.join(", ")}` : ""));
  }
  opts = { ...opts, providers };
  const byId = new Map(opts.providers.map((p) => [p.id, p]));

  // Point the shared browser engine at the configured remote browser (its constants read these env
  // vars). Set before the ./browser module is first (lazily) imported by a scrape job.
  if (opts.browser?.cdpUrl) process.env.PLAYWRIGHT_VNC_CDP_URL = opts.browser.cdpUrl;
  if (opts.browser?.camoufoxWs) process.env.PLAYWRIGHT_VNC_CAMOUFOX_WS = opts.browser.camoufoxWs;

  // Lazy-load the browser engine ONLY when a provider needs it, so deterministic providers never
  // pull in playwright-core. Uses the SAME loadPage/waitForChallengeToClear as the central scraper.
  let browserMod: typeof import("./browser") | null = null;
  async function renderViaBrowser(
    url: string,
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit"
  ): Promise<string> {
    if (!browserMod) browserMod = await import("./browser");
    const { loadPage, waitForChallengeToClear } = browserMod;
    return loadPage(url, {
      waitUntil: waitUntil ?? "domcontentloaded",
      timeout: 45_000,
      evaluate: async (page) => {
        await waitForChallengeToClear(page);
        return page.content();
      },
    });
  }

  const connection = new IORedis(opts.redisUrl, { maxRetriesPerRequest: null });

  // Queues the worker enqueues result-jobs TO (the central consumes them).
  const sinks = {
    register: new Queue(QUEUE_REGISTER_PROVIDER, { connection }),
    saveDiscovered: new Queue(QUEUE_SAVE_DISCOVERED, { connection }),
    saveScraped: new Queue(QUEUE_SAVE_SCRAPED, { connection }),
    completeRun: new Queue(QUEUE_COMPLETE_RUN, { connection }),
  };
  const add = <P>(q: Queue, name: string, payload: P): Promise<Job<JobEnvelope<P>>> =>
    q.add(name, envelope(payload)) as Promise<Job<JobEnvelope<P>>>;

  // 1) Advertise each provider to the central catalog (idempotent).
  for (const p of opts.providers) {
    const payload: RegisterProviderPayload = {
      id: p.id,
      domains: [...p.domains],
      businessDomain: p.businessDomain ?? "real_estate",
      queue: p.id,
      strategy: p.strategy ?? null,
      tier: tierOf(p),
      catalog: opts.catalog ?? null,
    };
    await add(sinks.register, "registerProvider", payload);
    log.info(`[provider-worker] registered ${p.id} (${p.domains.join(", ")})`);
  }

  // 2) Consume this worker's lanes.
  const workers: Worker[] = [];

  async function discoverProcessor(job: Job<JobEnvelope<DiscoverLanePayload>>): Promise<void> {
    const { runId, providerId, domain, seedUrl, resumeFrom, limit, language } = job.data.payload;
    const provider = byId.get(providerId);
    if (!provider?.discover) throw new Error(`worker cannot discover provider ${providerId}`);
    let discovered = 0;
    try {
      for await (const batch of provider.discover(seedUrl, { limit, language, resumeFrom })) {
        discovered += batch.listings.length;
        const payload: SaveDiscoveredPayload = {
          runId,
          providerId,
          domain,
          language,
          listings: batch.listings,
          cursor: batch.cursor ?? null,
          discoveredCount: discovered,
        };
        await add(sinks.saveDiscovered, "saveDiscovered", payload);
      }
      const done: CompleteRunPayload = { runId, status: "completed", discoveredCount: discovered };
      await add(sinks.completeRun, "completeRun", done);
      log.info(`[provider-worker] ${providerId} discovery complete (${discovered})`);
    } catch (err) {
      const partial: CompleteRunPayload = {
        runId,
        status: "partial",
        discoveredCount: discovered,
        error: err instanceof Error ? err.message : String(err),
      };
      await add(sinks.completeRun, "completeRun", partial);
      throw err; // let BullMQ retry the lane job; the run stays resumable from its cursor
    }
  }

  async function scrapeProcessor(job: Job<JobEnvelope<ScrapeLanePayload>>): Promise<void> {
    const { discoveredListingId, providerId, url } = job.data.payload;
    const provider = byId.get(providerId);
    if (!provider) throw new Error(`worker does not own provider ${providerId}`);
    const domain = provider.businessDomain ?? "real_estate";
    try {
      if (!provider.extractDetails) {
        throw new Error(`provider ${providerId} has no extractDetails (LLM extraction is central-only)`);
      }
      // Render via the shared browser engine when the provider asks for it; otherwise a plain HTTP
      // fetch (deterministic, no browser).
      const html =
        provider.detailFetchEngine === "browser"
          ? await renderViaBrowser(url, opts.browser?.waitUntil)
          : await fetchHtml(url, { timeoutMs: 30_000 });
      const det = await provider.extractDetails({ html, fullHtml: html, url });
      if (!det.ad) throw new Error(det.warnings.join("; ") || "extraction produced no ad");

      const { pageContent, ...raw } = det.ad as Record<string, unknown> & { pageContent?: string };
      // Produce the embeddable `pageContent` the central's in-process path would (the central
      // persists a remote worker's `pageContent` verbatim — it does NOT re-render). Precedence:
      // a value the provider baked into the ad → the provider's `pageContent()` hook → a cleaned
      // Markdown render of the detail HTML (content-selector scoped). Null only when skipped.
      const resolvedPageContent = provider.skipPageContent
        ? null
        : await resolvePageContent(provider, { html, url, adPageContent: pageContent });
      const payload: SaveScrapedPayload = {
        discoveredListingId,
        providerId,
        domain,
        url,
        raw: { ...raw, ...(det.raw ?? {}) },
        pageContent: resolvedPageContent,
        warning: det.warnings.join("; ") || null,
        sourceUrl: (raw.sourceUrl as string | undefined) ?? null,
      };
      await add(sinks.saveScraped, "saveScraped", payload);
    } catch (err) {
      // Report the failure so the central can flip the listing to `failed` (idempotent by id).
      const payload: SaveScrapedPayload = {
        discoveredListingId,
        providerId,
        domain,
        url,
        error: err instanceof Error ? err.message : String(err),
      };
      await add(sinks.saveScraped, "saveScraped", payload);
      throw err; // surface for BullMQ retry/backoff on the lane
    }
  }

  for (const p of opts.providers) {
    workers.push(
      new Worker<JobEnvelope<DiscoverLanePayload>, void>(discoverLane(p.id), discoverProcessor, {
        connection,
        concurrency,
      })
    );
    workers.push(
      new Worker<JobEnvelope<ScrapeLanePayload>, void>(scrapeLane(p.id), scrapeProcessor, {
        connection,
        concurrency,
      })
    );
    log.info(`[provider-worker] consuming ${discoverLane(p.id)} + ${scrapeLane(p.id)}`);
  }

  async function stop(): Promise<void> {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(sinks).map((q) => q.close()));
    connection.disconnect();
  }

  // Graceful drain on signals.
  const onSignal = (sig: string) => {
    log.info(`[provider-worker] ${sig} — draining`);
    void stop().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  return { stop };
}

export interface RunCatalogWorkerOptions extends Omit<RunProviderWorkerOptions, "providers" | "catalog"> {
  /**
   * Absolute glob for the catalog's providers, resolved by the CALLER from its own `__dirname` (so it
   * targets `src/` under tsx and `lib/` after tsc) — e.g.
   * `path.join(__dirname, "providers/**​/*.provider.{js,ts}")`.
   */
  providersGlob: string;
}

/**
 * Resolve the running image's version: `CATALOG_VERSION` (Helm sets it to the resolved image tag),
 * else the app's own `package.json` `version` (baked into the image at build), else "0.0.0".
 */
function readPkgVersion(): string {
  if (process.env.CATALOG_VERSION) return process.env.CATALOG_VERSION;
  try {
    // The catalog app's package.json — resolved from CWD (the app root at runtime).
    const pkg = require(require("node:path").join(process.cwd(), "package.json")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Boot a **catalog** worker: auto-discover the catalog's providers via awilix glob (no registry
 * array), resolve the running image version, and run them all under one worker — advertising each
 * with the catalog's metadata so the central files them under this catalog (category) and the admin
 * shows the catalog as a plugin card. Redis is the only dependency.
 */
export function runCatalogWorker(
  manifest: CatalogManifest,
  opts: RunCatalogWorkerOptions,
): Promise<RunningProviderWorker> {
  const { providersGlob, ...rest } = opts;
  const providers = loadProvidersFromDi(providersGlob);
  if (providers.length === 0) {
    throw new Error(`catalog "${manifest.id}" loaded 0 providers from ${providersGlob}`);
  }
  return runProviderWorker({
    ...rest,
    providers,
    catalog: {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      market: manifest.market,
      version: readPkgVersion(),
    },
  });
}
