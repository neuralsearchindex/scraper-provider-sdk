---
name: add-provider
description: Add (enroll) a new site provider into this scraper catalog — a src/providers/<id>/<id>.provider.ts that teaches the catalog how to discover a site's listing URLs and deterministically extract a listing. Use when asked to add/support a new site, portal, dealer, or agency to this catalog, or to write a provider's discover()/extractDetails(). Walks the cheapest-source-first discovery decision tree: RSS/Atom feed → sitemap (incl. index + .xml.gz) → JSON/GraphQL API → __NEXT_DATA__ → list-page scrape.
---

# Add a provider to `__CATALOG_ID__-catalog`

A **provider** is one file for one site: `src/providers/<id>/<id>.provider.ts`. The SDK
**auto-discovers** it (awilix glob — no registry array); its default export is a factory
`() => SiteProvider`. This catalog serves market `__CATALOG_MARKET__`, vertical
`__CATALOG_BUSINESS_DOMAIN__`. `<id>` is `<brand>-<tld>` (e.g. `newhome-ch`, `carvago-com`).

## Step 1 — Reconnaissance: find the cheapest deterministic source

The goal of `discover()` is a **complete list of detail-page URLs without a blind crawl**.
Investigate the site in this order and stop at the first that works:

1. **`robots.txt` + sitemaps** — `robots.txt` usually points at one or more sitemaps (often more
   than `/sitemap.xml`). Are listing **detail** URLs in a `<urlset>` directly, or only search/list
   pages? A `<sitemapindex>` nests child sitemaps; large sites ship gzipped `*.xml.gz`.
   ```bash
   curl -s https://<site>/robots.txt
   curl -s https://<site>/sitemap.xml | head -50
   ```
2. **RSS / Atom feed** — try `/feed`, `/rss.xml`, `/de/feed/rss.xml`, `/feed/rss.xml`. Cheapest of
   all — plain HTTP, no browser, one document.
3. **JSON / GraphQL API** — open the site's search page, DevTools → Network, filter XHR/fetch, run a
   search. The endpoint the frontend calls (`/api…`, `/apirequest`, a GraphQL POST) usually returns
   per-card JSON with an id + images. Reproduce with `curl` to confirm it needs no auth/JS.
4. **`__NEXT_DATA__`** (Next.js SSR) — `view-source` the search page; if it has
   `<script id="__NEXT_DATA__">`, the results are in it.
5. **List-page scrape** — only if 1–4 fail: scrape each list/search page and collect its detail links.

Also note during recon:
- **Cloudflare / bot wall?** `curl` returns "Just a moment…" / "you have been blocked" → yes → you
  MUST fetch via the browser engine, not bare fetch (see below).
- **Locales** the site serves, and whether it localizes URL paths per locale.
- Set the provider's **`tier`**: a single dealer's/agency's own site → `"agency"`; a large
  multi-seller aggregator → `"portal"` (operators can hold portals back via `CATALOG_TIERS`).

## Step 2 — Scaffold the provider

Fastest: seed one when you create the catalog (`create-scraper-catalog <id> --provider <site-id>`),
or drop the file yourself. Skeleton:

```ts
import type { SiteProvider, DiscoverOptions, DiscoveryBatch, ProviderPageInput } from "@neuralsearchindex/scraper-provider-sdk";

export const <ID>_LANGUAGES = ["de"] as const;               // the locales the site serves
export function resolveLanguage(lang?: string) {              // narrow → supported, silent fallback
  return (<ID>_LANGUAGES as readonly string[]).includes(lang ?? "") ? (lang as ...) : "de";
}

export default function make<Id>Provider(): SiteProvider {
  return {
    id: "<brand>-<tld>",
    domains: ["<site-domain>"],
    businessDomain: "__CATALOG_BUSINESS_DOMAIN__",
    tier: "agency",                                           // "agency" | "portal"
    async *discover(seedUrl, opts) { /* yield { listings, cursor? } */ },
    async extractDetails(input) { /* → { ad, images?, warnings } */ },
  };
}
export type <Id>Provider = ReturnType<typeof make<Id>Provider>;
```

## Step 3 — `discover()` — pick the source, use the SDK helper

Stream `{ listings, cursor? }` batches (`listings: { url, images?, lastmod? }[]`). Import helpers from
`@neuralsearchindex/scraper-provider-sdk/parse` and the engine from `.../engine`:

| Source found                         | SDK helper to use                                                        |
|--------------------------------------|--------------------------------------------------------------------------|
| RSS / Atom feed                      | `fetchText(url)` + parse the XML (or cheerio)                            |
| Sitemap `<loc>`s = detail URLs       | `fetchSitemapEntries(url, "curl")` → `{ loc, lastmod }[]`               |
| Sitemap **index** → child sitemaps   | `fetchSitemapLocs(indexUrl)` → then walk each child                     |
| Gzipped `*.xml.gz` sitemap           | `fetchSitemapXml(url)` (gunzips) → `parseSitemapLocs` / `parseSitemapEntries` |
| Image sitemap (per-`<url>` images)   | `fetchSitemapXml(url)` → `parseSitemapImageEntries(xml)`                |
| Cloudflare-gated sitemap/page        | `fetchSitemapEntries(url, "browser")` / `scrape(url, { fetchEngine: "browser" })` |
| JSON / GraphQL API                   | `fetchText`/`fetch` the endpoint; map cards → `{ url, images }`         |
| `__NEXT_DATA__` SSR                  | `nextDataPageProps(html)`                                               |
| List page → links                    | `scrape(url, { fetchEngine })` + cheerio `extractLinks`                 |

**Rules (every provider):** fail soft (try/catch → skip a bad page, never throw the whole stream);
honour `opts.limit` (0 = unbounded) and walk **lazily**; honour `opts.language`; dedupe by URL with a
`Set`; carry `images`/`lastmod` forward; yield a `cursor` per source page so a run is resumable.
Never bare-`fetch` a Cloudflare-gated URL — you'll parse the "Just a moment…" page; use
`fetchEngine: "browser"` (the worker renders via the bundled `playwright-vnc`).

## Step 4 — `extractDetails()` — deterministic, no LLM

Return `{ ad, images?, raw?, warnings }` (`ad: null` + a warning ⇒ the central falls back to the LLM).

- **Vehicles** — schema.org `Car` JSON-LD → `schemaOrgVehicleDetails()` (a ready hook). Otherwise map
  the native payload (`__NEXT_DATA__` / a detail API) to a `VehicleAd` (`mapCarNodeToVehicle`, the
  `VehicleAd` type).
- **Real estate** — build a `facets` table and wrap it with `facetsToDetails(facets)`. Reuse
  `schemaOrgPropertyFacets()` / `immomigDetails()` (JSON-LD portals) or the `html-facets` helpers
  (`ogMeta`, `parseArea`, `parseChfPrice`, `featuresFrom`, `splitSwissCity`, …) for label→value HTML
  themes. All from `@neuralsearchindex/scraper-provider-sdk/parse`.
- Browser-gated detail pages: set `detailFetchEngine: "browser"`.

## Step 5 — Test on fixtures (no live network)

Export pure helpers (URL builders, parsers, `resolveLanguage`) and unit-test them with `node:test`
against **fixtures** saved under `__fixtures__/` (a real page/API response). Never hit the live site
in a test. Then `pnpm types:check && pnpm test && pnpm build`. For a real end-to-end run, follow
`.claude/skills/test-catalog/SKILL.md` (docker compose).

No registration step — the file is auto-discovered and ships in the next image, registering with the
central catalog on boot (respecting `CATALOG_TIERS`).
