/**
 * Shared helpers for providers that must parse **raw HTML** for their facets (no
 * `__NEXT_DATA__` / JSON-LD / API) — typically WordPress/casawp real-estate themes that
 * render a German label→value table plus og-meta. Keeps the per-provider file to just
 * its selectors + label dictionary.
 */
import * as cheerio from "cheerio";

import type { DetailExtraction, DetailExtractor, ProviderPageInput } from "../contract";
import { mapFacetsToPropertyAd, type FacetBag } from "./property/assemble";
import {
  FACET_KEYS,
  type CapabilityResult,
  type FacetExtractors,
  type FacetKey,
  type FacetOutputs,
} from "./property/facet-types";

/** og:/twitter/meta values a detail page usually carries. */
export interface OgMeta {
  title: string | null;
  description: string | null;
  image: string | null;
}

/** Read og:title / og:description / og:image (falling back to `<title>`). */
export function ogMeta(html: string): OgMeta {
  const $ = cheerio.load(html);
  const meta = (p: string) =>
    $(`meta[property="${p}"]`).attr("content") ?? $(`meta[name="${p}"]`).attr("content") ?? null;
  return {
    title: meta("og:title") ?? ($("title").first().text().trim() || null),
    description: meta("og:description"),
    image: meta("og:image"),
  };
}

/** Strip a site-name suffix like "Sublime | TI - Property One" → "Sublime | TI". */
export function stripSiteSuffix(title: string | null, sep = " - "): string | null {
  if (!title) return null;
  const i = title.lastIndexOf(sep);
  return (i > 0 ? title.slice(0, i) : title).trim() || null;
}

/** First number in a string (handles `1'221`, `326 m²`, `3.5`), else null. */
export function firstNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/['’\s]/g, "").match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** An `{ value, unit:"m²" }` area parsed from a label value (e.g. "326 m²"), or null. */
export function parseArea(s: string | null | undefined): { value: number; unit: "m²" } | null {
  const n = firstNumber(s);
  return n != null && n > 0 ? { value: n, unit: "m²" } : null;
}

/** A CHF price integer from "CHF 4'950'000.-" (null for "Auf Anfrage"/on-request). */
export function parseChfPrice(s: string | null | undefined): number | null {
  if (!s || /anfrage|request|auf anfrage|verhandl/i.test(s)) return null;
  const digits = s.replace(/['’\s]/g, "").match(/\d+/);
  const n = digits ? Number(digits[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** German/French condition string → the condition enum, or null. */
export function germanCondition(raw: string | null | undefined): FacetOutputs["generalInfo"]["condition"] {
  const s = (raw ?? "").toLowerCase();
  if (!s) return null;
  if (/neubau|im bau|rohbau|en construction/.test(s)) return "under_construction";
  if (/sanierungsbedürftig|renovationsbedürftig|à rénover|da ristrutturare/.test(s)) return "needs_renovation";
  if (/neuwertig|\bneu\b|\bnew\b|neuf/.test(s)) return "new";
  if (/renoviert|saniert|rénové|ristrutturato/.test(s)) return "renovated";
  if (/gepflegt|keine renovation|bien entretenu|well.?maintained/.test(s)) return "well_maintained";
  return null;
}

/** A feature label/keyword (DE/FR/IT) → a boolean Features flag, or null (→ additional). */
export function featureFlag(text: string): keyof FacetOutputs["features"] | null {
  const s = text.toLowerCase();
  const table: Array<[keyof FacetOutputs["features"], RegExp]> = [
    ["balcony", /balkon|balcon|balcone/],
    ["terrace", /terrasse|terrazz/],
    ["garden", /garten|jardin|giardino|gartensitz/],
    ["elevator", /lift|aufzug|ascenseur|ascensore/],
    ["garage", /garage|einstellhalle/],
    ["parking", /parkplatz|parking|stellplatz|posto auto/],
    ["cellar", /keller|cave|cantina/],
    ["fireplace", /cheminée|cheminee|kamin|kachelofen|camino/],
    ["dishwasher", /geschirrspül|lave-vaisselle|lavastoviglie/],
    ["airConditioning", /klimaanlage|klimatisiert|climatisation|aria condizionata/],
    ["swimmingPool", /schwimmbad|piscine|piscina|pool/],
    ["wheelchairAccessible", /rollstuhl|behindertengerecht|barrierefrei/],
    ["furnished", /möbliert|meublé|arredato|furnished/],
    ["petsAllowed", /haustiere|animaux|animali/],
  ];
  for (const [flag, rx] of table) if (rx.test(s)) return flag;
  return null;
}

/**
 * Turn a list of `{label, value}` feature/amenity strings into a Features facet: known
 * keywords set boolean flags, everything else lands in `additionalFeatures`.
 */
export function featuresFrom(items: Array<{ label?: string; value?: string }>): FacetOutputs["features"] {
  const out: FacetOutputs["features"] = { additionalFeatures: null };
  const extra: string[] = [];
  for (const it of items) {
    const text = `${it.label ?? ""} ${it.value ?? ""}`.trim();
    if (!text) continue;
    const flag = featureFlag(text);
    if (flag) (out as Record<string, unknown>)[flag] = true;
    else if (it.value?.trim()) extra.push(it.value.trim());
    else if (it.label?.trim()) extra.push(it.label.trim());
  }
  if (extra.length) out.additionalFeatures = [...new Set(extra)];
  return out;
}

/** Parse "8802 Kilchberg ZH" → { postalCode, city } (city keeps any canton suffix). */
export function splitSwissCity(v: string | null | undefined): { postalCode: string; city: string } {
  const m = (v ?? "").trim().match(/^(\d{4})\s+(.+)$/);
  return m ? { postalCode: m[1], city: m[2].trim() } : { postalCode: "", city: (v ?? "").trim() };
}

/**
 * Build a `facets` table from a per-page mapper that returns a partial `FacetOutputs`
 * bundle. The mapper runs once per page (memoised single-slot by HTML), so all facets
 * share one parse. Each listed key reads its slice; unlisted facets stay generic/empty.
 */
export function memoizedBundleFacets<K extends FacetKey>(
  map: (html: string) => Partial<Pick<FacetOutputs, K>> | null,
  keys: readonly K[]
): FacetExtractors {
  let cachedSrc: string | null = null;
  let cachedOut: Partial<Pick<FacetOutputs, K>> | null = null;
  const get = (html: string) => {
    if (html !== cachedSrc) {
      cachedSrc = html;
      cachedOut = map(html);
    }
    return cachedOut;
  };
  const facet =
    (key: K) =>
    async ({ html, fullHtml }: ProviderPageInput): Promise<CapabilityResult<FacetOutputs[K]>> => ({
      data: (get(fullHtml ?? html)?.[key] ?? null) as FacetOutputs[K] | null,
      warnings: [],
    });
  const out: FacetExtractors = {};
  for (const k of keys) (out as Record<FacetKey, unknown>)[k] = facet(k);
  return out;
}

/**
 * Bridge a property provider's per-facet {@link FacetExtractors} into the unified
 * {@link DetailExtractor} (`extractDetails`): run every facet mapper over the page
 * (a facet the provider omits → empty, NEVER the LLM), assemble the {@link FacetBag}
 * into a PropertyAd, and return it. Images and the native `raw` are baked into the
 * assembled ad (from the `images`/`raw` facets), so only `ad` + `warnings` are set.
 * This lets every property provider expose the same `extractDetails` hook as vehicles.
 */
export function facetsToDetails(facets: FacetExtractors): DetailExtractor {
  return async (input: ProviderPageInput): Promise<DetailExtraction> => {
    const results = await Promise.all(
      FACET_KEYS.map(async (key) => {
        const fn = facets[key] as
          | ((i: ProviderPageInput) => Promise<CapabilityResult<unknown>>)
          | undefined;
        return { key, result: fn ? await fn(input) : { data: null, warnings: [] } };
      })
    );
    const warnings: string[] = [];
    const bag: FacetBag = { pageURL: input.url };
    const channels = bag as unknown as Record<string, unknown>;
    for (const { key, result } of results) {
      warnings.push(...result.warnings);
      // FacetBag names the agent channel `agentInfo`; every other key is 1:1.
      channels[key === "agent" ? "agentInfo" : key] = result.data ?? undefined;
    }
    const ad = mapFacetsToPropertyAd(bag, warnings) as unknown as Record<string, unknown>;
    return { ad, warnings };
  };
}

/** Like {@link memoizedBundleFacets} but returns the unified {@link DetailExtractor}. */
export function memoizedBundleDetails<K extends FacetKey>(
  map: (html: string) => Partial<Pick<FacetOutputs, K>> | null,
  keys: readonly K[]
): DetailExtractor {
  return facetsToDetails(memoizedBundleFacets(map, keys));
}

/** cheerio loader re-exported so providers share one import. */
export { cheerio };
