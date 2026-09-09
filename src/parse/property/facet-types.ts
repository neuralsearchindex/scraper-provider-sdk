/**
 * The property-ad facet type system — ported from the central scraper's `provider.interface`. A
 * provider supplies deterministic extractors ONLY for the facets it can do; the rest stay empty
 * (never the LLM, on the remote path). `facetsToDetails` (html-facets) folds a facet bag into a
 * PropertyAd via `mapFacetsToPropertyAd` (assemble).
 */
import type { ProviderPageInput } from "../../contract";
import type { PropertyAdImage } from "./property-ad.schema";
import type { GeneralInfo } from "./facets/general-info";
import type { Price } from "./facets/price";
import type { Location } from "./facets/location";
import type { Measurements } from "./facets/measurements";
import type { Counts } from "./facets/counts";
import type { Years } from "./facets/years";
import type { Features } from "./facets/features";
import type { Availability } from "./facets/availability";
import type { Energy } from "./facets/energy";
import type { AgentInfo } from "./facets/agent-info";

/** Uniform result for any facet extractor: value (null on miss) + non-fatal warnings. */
export interface CapabilityResult<T> {
  data: T | null;
  warnings: string[];
}

/** The complete "all info" surface: one entry per property-ad facet. */
export interface FacetOutputs {
  generalInfo: GeneralInfo;
  price: Price;
  location: Location;
  measurements: Measurements;
  counts: Counts;
  years: Years;
  features: Features;
  availability: Availability;
  energy: Energy;
  agent: AgentInfo;
  images: PropertyAdImage[];
  /** The provider's full native listing payload, preserved verbatim. */
  raw: Record<string, unknown>;
}

export type FacetKey = keyof FacetOutputs;

/** All facet keys, in the fixed order used when composing a page's facet bag. */
export const FACET_KEYS: readonly FacetKey[] = [
  "generalInfo",
  "price",
  "location",
  "measurements",
  "counts",
  "years",
  "features",
  "availability",
  "energy",
  "agent",
  "images",
  "raw",
];

/** One facet extractor: page → the facet's value (or null) + warnings. */
export type FacetExtractor<K extends FacetKey> = (
  input: ProviderPageInput,
) => Promise<CapabilityResult<FacetOutputs[K]>>;

/** A provider supplies extractors ONLY for the facets it can do deterministically. */
export type FacetExtractors = {
  [K in FacetKey]?: FacetExtractor<K>;
};
