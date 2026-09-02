/**
 * The BullMQ wire contract shared with the central scraper. These queue names + payload shapes MUST
 * match the central's `scrapingJobActionCreator` queues and the `remote-queue.service` lanes. Every
 * BullMQ job's `data` is the `{ payload, meta }` envelope the central's JobsManager uses.
 */

import type { BusinessDomain, DiscoveryCursor, ExtractionStrategy } from "./contract";

/** The central's JobsManager job-data envelope. */
export interface JobEnvelope<P> {
  payload: P;
  meta: Record<string, unknown>;
}

export const envelope = <P>(payload: P): JobEnvelope<P> => ({ payload, meta: {} });

// ── Central-consumed sink queues (the worker enqueues TO these) ─────────────────────────────
export const QUEUE_REGISTER_PROVIDER = "scraping/registerProvider";
export const QUEUE_SAVE_DISCOVERED = "scraping/saveDiscovered";
export const QUEUE_SAVE_SCRAPED = "scraping/saveScraped";
export const QUEUE_COMPLETE_RUN = "scraping/completeRun";

// ── Worker-consumed lanes (the central dispatches TO these; keyed per provider) ──────────────
// NOTE: BullMQ forbids ":" in queue names (it's the internal key separator), so lanes use ".".
export const discoverLane = (queue: string): string => `discover.${queue}`;
export const scrapeLane = (queue: string): string => `scrape.${queue}`;

// ── Payloads ────────────────────────────────────────────────────────────────────────────────

export interface RegisterProviderPayload {
  id: string;
  domains: string[];
  businessDomain: BusinessDomain;
  queue?: string;
  seedUrl?: string | null;
  languages?: string[] | null;
  strategy?: ExtractionStrategy | null;
}

/** Central → worker discover lane. */
export interface DiscoverLanePayload {
  runId: string;
  providerId: string;
  domain: string;
  seedUrl: string;
  resumeFrom?: DiscoveryCursor;
  limit?: number;
  language?: string;
}

/** Central → worker scrape lane. */
export interface ScrapeLanePayload {
  discoveredListingId: string;
  providerId: string;
  url: string;
}

export interface SaveDiscoveredPayload {
  runId: string;
  providerId: string;
  domain: string;
  language?: string;
  listings: { url: string; images?: string[]; lastmod?: string; raw?: Record<string, unknown> }[];
  cursor?: DiscoveryCursor | null;
  discoveredCount?: number;
}

export interface SaveScrapedPayload {
  discoveredListingId: string;
  providerId: string;
  domain: string;
  url: string;
  raw?: Record<string, unknown>;
  pageContent?: string | null;
  warning?: string | null;
  sourceUrl?: string | null;
  error?: string | null;
}

export interface CompleteRunPayload {
  runId: string;
  status: "completed" | "partial" | "failed";
  discoveredCount?: number;
  error?: string;
}
