/**
 * Shared `__NEXT_DATA__` reader for Next.js-rendered portals.
 *
 * Next.js server-renders the page's initial props into a
 * `<script id="__NEXT_DATA__" type="application/json">…</script>` blob. Several
 * providers (otodom, otomoto, engel & völkers, …) read their listing/search data
 * straight out of it — no HTML parsing, no LLM. This centralises the one primitive
 * they all share: pull + parse that blob. Each provider then navigates its own
 * `props.pageProps.*` path (the shapes differ per site).
 *
 * The parse is memoised single-slot by the exact HTML string: a detail page runs
 * many facet mappers over the same `fullHtml`, so the (~half-MB) blob is parsed
 * once per page rather than once per facet.
 */

let cachedSrc: string | null = null;
let cachedData: unknown = null;

/**
 * Parse the `__NEXT_DATA__` JSON out of a page's HTML. Returns `null` when the blob
 * is absent or not valid JSON, so callers never throw on a bad/blocked page.
 */
export function extractNextData(html: string): unknown {
  if (html === cachedSrc) return cachedData;
  cachedSrc = html;
  cachedData = null;
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    cachedData = JSON.parse(m[1]);
  } catch {
    cachedData = null;
  }
  return cachedData;
}

/** `props.pageProps` from a page's `__NEXT_DATA__` (typed by the caller), or `null`. */
export function nextDataPageProps<T = Record<string, unknown>>(
  html: string
): T | null {
  const nd = extractNextData(html) as { props?: { pageProps?: T } } | null;
  return nd?.props?.pageProps ?? null;
}
