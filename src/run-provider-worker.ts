import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import type { SiteProvider } from "./contract";
import { fetchHtml, fetchRendered } from "./engine";
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
   * Optional REMOTE browser (CDP) for JS-heavy sites. When set, providers whose
   * `detailFetchEngine === "browser"` render detail pages via this browser instead of plain fetch.
   * Requires the optional peer dependency `playwright-core`. Omit (or set `detailFetchEngine: "curl"`)
   * for deterministic providers — they stay browserless and tiny.
   */
  browser?: { cdpUrl: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit" };
  /** Optional structured logger; defaults to console. */
  logger?: Pick<Console, "info" | "warn" | "error">;
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
export async function runProviderWorker(opts: RunProviderWorkerOptions): Promise<RunningProviderWorker> {
  const log = opts.logger ?? console;
  const concurrency = opts.concurrency ?? 4;
  const byId = new Map(opts.providers.map((p) => [p.id, p]));

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
      // Render via the remote browser when the provider asks for it and a CDP url is configured;
      // otherwise a plain HTTP fetch (deterministic, no browser).
      const useBrowser = provider.detailFetchEngine === "browser";
      if (useBrowser && !opts.browser?.cdpUrl) {
        throw new Error(
          `provider ${providerId} requires a browser (detailFetchEngine="browser") but runProviderWorker was started without browser.cdpUrl`
        );
      }
      const html =
        useBrowser && opts.browser
          ? await fetchRendered(url, { cdpUrl: opts.browser.cdpUrl, waitUntil: opts.browser.waitUntil, timeoutMs: 45_000 })
          : await fetchHtml(url, { timeoutMs: 30_000 });
      const det = await provider.extractDetails({ html, fullHtml: html, url });
      if (!det.ad) throw new Error(det.warnings.join("; ") || "extraction produced no ad");

      const { pageContent, ...raw } = det.ad as Record<string, unknown> & { pageContent?: string };
      const payload: SaveScrapedPayload = {
        discoveredListingId,
        providerId,
        domain,
        url,
        raw: { ...raw, ...(det.raw ?? {}) },
        pageContent: provider.skipPageContent ? null : pageContent ?? null,
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
