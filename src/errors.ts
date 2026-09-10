/**
 * Error tracking for catalog workers — exceptions grouped into issues in the
 * platform's GlitchTip.
 *
 * ── Why this is not `@neuralsearchindex/sdk-node/errors` ───────────────────
 *
 * It is a near-copy of that module, on purpose. sdk-node is the platform's
 * heavy SDK — langchain, mikro-orm, milvus, opensearch, better-auth — and a
 * catalog image has THREE dependencies. Depending on sdk-node to get one
 * Sentry init would multiply every catalog image's size and install time for
 * no other benefit. The env contract below is identical to sdk-node's, so the
 * chart wires both the same way and the two cannot drift apart silently
 * without the variable names diverging first.
 *
 * A catalog worker is the case where error tracking earns its keep: it has no
 * HTTP surface, so nothing 500s and nobody notices. A provider whose selectors
 * broke fails every job, the pod stays Running, /health does not exist, and
 * the only symptom is listings quietly not arriving.
 */
import * as Sentry from "@sentry/node";

/*
 * NB: bare `require`, unlike sdk-node's errors module, which must use
 * createRequire(import.meta.url). This package compiles to CommonJS
 * ("type": "commonjs", module: commonjs) where `require` is in scope and
 * `import.meta` is a compile error; sdk-node is ESM, where the reverse holds.
 * Copying either one into the other silently disables profiling — that
 * mistake was already made once and only surfaced as a single boot warning.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
declare const require: (id: string) => any;

let started = false;

function rate(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  // A typo in a values file should cost nothing, not silently bill full tracing.
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
}

export interface InitErrorsOptions {
  /** Component name — the chart passes `<catalog-id>-catalog` as SENTRY_SERVICE. */
  service?: string;
}

/**
 * Initialise error tracking from the environment the Helm chart injects.
 * Returns false — normally, not exceptionally — when SENTRY_DSN is unset,
 * which is every cluster before the GlitchTip bootstrap has run.
 *
 * Called automatically by {@link runCatalogWorker}, so existing catalogs get
 * this with no per-repo change. New scaffolds also import the side-effect
 * module first (see the template's src/index.ts), which additionally lets
 * Sentry patch http/undici before the app touches them; the double call is a
 * no-op thanks to the guard below.
 */
export function initCatalogErrors(opts: InitErrorsOptions = {}): boolean {
  if (started) return true;

  const dsn = process.env.SENTRY_DSN ?? "";
  if (!dsn.trim()) return false;

  const service = opts.service ?? process.env.SENTRY_SERVICE ?? "catalog";
  const profilesSampleRate = rate(process.env.SENTRY_PROFILES_SAMPLE_RATE);

  const integrations = [Sentry.extraErrorDataIntegration()];
  if (profilesSampleRate > 0) {
    try {
      const { nodeProfilingIntegration } = require("@sentry/profiling-node");
      integrations.push(nodeProfilingIntegration());
    } catch (err) {
      // Announced, never swallowed: a profiles rate that is configured but not
      // in effect is exactly the sort of thing that gets trusted for months.
      // @sentry/profiling-node IS a dependency here, so reaching this branch
      // means a real problem — most likely a platform with no prebuilt binary.
      // Errors still work, which is why this warns rather than throws.
      console.warn(
        `[catalog-errors] profiling requested but @sentry/profiling-node is not ` +
          `installed — profiling OFF for ${service}; errors and tracing unaffected. ` +
          `(${(err as Error).message})`,
      );
    }
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE || undefined,
    integrations,
    tracesSampleRate: rate(process.env.SENTRY_TRACES_SAMPLE_RATE),
    profilesSampleRate,
    includeLocalVariables: process.env.SENTRY_INCLUDE_LOCAL_VARIABLES === "true",
  });
  Sentry.setTag("service", service);

  started = true;
  return true;
}

export function catalogErrorsEnabled(): boolean {
  return started;
}

export interface CaptureCatalogErrorOptions {
  provider?: string;
  /** "discover" | "scrape" — which lane the job came from. */
  lane?: string;
  catalog?: string;
  url?: string;
  jobId?: string | number;
  attemptsMade?: number;
  maxAttempts?: number;
}

/**
 * Report a failed catalog job.
 *
 * Grouped by PROVIDER and lane rather than by job or URL. A portal that
 * changes its markup fails every listing it has; that is one broken provider,
 * not ten thousand issues, and the console has to stay readable at exactly the
 * moment it is needed. The provider tag is what makes "otodom is broken again"
 * a one-line filter.
 *
 * Never throws — a reporter that can fail turns a handled failure into an
 * unhandled one, inside the retry path.
 */
export function captureCatalogError(err: unknown, opts: CaptureCatalogErrorOptions = {}): void {
  if (!started) return;
  try {
    Sentry.withScope((scope) => {
      if (opts.provider) scope.setTag("provider", opts.provider);
      if (opts.lane) scope.setTag("lane", opts.lane);
      if (opts.catalog) scope.setTag("catalog", opts.catalog);
      // Terminal vs. will-be-retried. A retried job is not yet a failure, and
      // without this the counts are inflated by every backoff attempt.
      if (opts.attemptsMade !== undefined && opts.maxAttempts !== undefined) {
        scope.setTag("terminal", String(opts.attemptsMade >= opts.maxAttempts));
      }
      scope.setContext("job", {
        jobId: opts.jobId,
        // The failing URL belongs in context, NOT in the fingerprint: putting
        // it in the grouping key gives one issue per listing.
        url: opts.url,
        attemptsMade: opts.attemptsMade,
        maxAttempts: opts.maxAttempts,
      });
      scope.setFingerprint(["catalog", opts.provider ?? "unknown", opts.lane ?? "unknown", "{{ default }}"]);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch {
    /* telemetry must never break the worker */
  }
}

/** Flush buffered events on shutdown; batched events are otherwise dropped. */
export async function closeCatalogErrors(timeoutMs = 2000): Promise<void> {
  if (!started) return;
  try {
    await Sentry.close(timeoutMs);
  } catch {
    /* shutting down anyway */
  }
}
