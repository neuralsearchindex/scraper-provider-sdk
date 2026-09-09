/**
 * Deterministically fold the per-facet extraction results into a single
 * {@link PropertyAd}. The facet schemas are intentionally NOT 1:1 with
 * `propertyAdSchema` (different unit strings, free-text enums, split objects),
 * so this is a real mapping + normalisation layer, then a `safeParse` gate.
 *
 * Philosophy: never fabricate. A field is only set when a facet actually
 * carried it; unmappable free-text (e.g. an exotic heating system) is dropped
 * rather than guessed, and a note is pushed to `warnings`. The one unavoidable
 * exception is `propertyTypeCategory`/`propertyTypeSubcategory`, which the root
 * schema requires — when the listing's property type can't be classified we
 * fall back to `flat`/`flat` and record why.
 */
import {
  propertyAdSchema,
  type PropertyAd,
  type ClassifiedImage,
} from "./property-ad.schema";
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

import { classifyPropertyType } from "./property-type";
export { classifyPropertyType, type PropertyType } from "./property-type";

/**
 * Plain facet bag the orchestrator assembles (replaces the LangGraph state).
 * `images` arrive already mapped to `{ url, order }` by `mapImagesFacet`;
 * `cleanedContent` is the embeddable handoff artifact (not a PropertyAd field).
 */
export interface FacetBag {
  generalInfo?: GeneralInfo | null;
  price?: Price | null;
  location?: Location | null;
  measurements?: Measurements | null;
  counts?: Counts | null;
  years?: Years | null;
  features?: Features | null;
  availability?: Availability | null;
  energy?: Energy | null;
  agentInfo?: AgentInfo | null;
  images?: { url: string; order: number }[];
  /** Full provider-native listing payload for fields not mapped to a facet. */
  raw?: Record<string, unknown> | null;
  cleanedContent?: string | null;
  pageURL: string;
}

// --- unit converters (facet "m²"/"m³" → schema "m2"/"m3") ---

type FacetArea = { value: number; unit: "m²" } | null | undefined;
type FacetVolume = { value: number; unit: "m³" } | null | undefined;
type FacetLength = { value: number; unit: "m" } | null | undefined;

const toM2 = (a: FacetArea) =>
  a && a.value != null ? { value: a.value, unit: "m2" as const } : undefined;
const toM3 = (v: FacetVolume) =>
  v && v.value != null ? { value: v.value, unit: "m3" as const } : undefined;
const toM = (l: FacetLength) =>
  l && l.value != null ? { value: l.value, unit: "m" as const } : undefined;

/** Drop `undefined`/`null` entries so we never write empty keys into strict schemas. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<T>;
}

/**
 * Recursively drop `null`/`undefined` at every depth. LLM facets (notably
 * `agentInfo` and `location`) emit `null` for absent optional fields, e.g.
 * `agent.agency.address.country: null` — but those schema fields are OPTIONAL,
 * not nullable, so a stray `null` fails `safeParse` and sinks the whole ad.
 * Stripping nulls turns them back into "absent", which optional fields accept.
 */
export function deepCompact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => deepCompact(v))
      .filter((v) => v !== undefined && v !== null) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = deepCompact(v);
    }
    return out as T;
  }
  return value;
}

// --- heating free-text → enum ---

type Heating =
  | "gas"
  | "oil"
  | "heat-pump"
  | "geothermal"
  | "pellet"
  | "district-heating"
  | "electric";

export function classifyHeating(
  ...raws: (string | null | undefined)[]
): Heating | undefined {
  const s = raws.filter(Boolean).join(" ").toLowerCase();
  if (!s) return undefined;
  if (
    s.includes("wärmepump") ||
    s.includes("waermepump") ||
    s.includes("heat pump") ||
    s.includes("heat-pump")
  )
    return "heat-pump";
  if (
    s.includes("geotherm") ||
    s.includes("erdwärme") ||
    s.includes("erdwaerme")
  )
    return "geothermal";
  if (
    s.includes("fernwärme") ||
    s.includes("fernwaerme") ||
    s.includes("district")
  )
    return "district-heating";
  if (s.includes("pellet")) return "pellet";
  if (s.includes("gas")) return "gas";
  if (s.includes("öl") || s.includes("oel") || s.includes("oil")) return "oil";
  if (s.includes("elektr") || s.includes("electric")) return "electric";
  if (s.includes("holz") || s.includes("wood")) return "pellet";
  return undefined;
}

/**
 * Map a classifier result set onto `propertyAdImageSchema`-shaped records.
 * Returned loosely typed; the root `safeParse` is the real gate.
 *
 * NOTE: SigLIP classification is out of scope for apps/scraper, so this helper
 * is retained for parity but the orchestrator passes already-mapped photos.
 */
export function mapImages(
  classified: ClassifiedImage[],
  fallbackUrls: string[]
): Array<Record<string, unknown>> {
  // A classifier entry with a resolved type is a real classification; entries
  // whose type came back null (fetch/encode failure) are treated as unclassified.
  const withClassification = classified.filter((r) => r.type !== null);
  if (withClassification.length > 0) {
    return withClassification.map((r, order) => ({
      url: r.url,
      order,
      type: r.type ?? undefined,
      room: r.room ?? undefined,
      meta: r.meta ?? undefined,
    }));
  }
  // No classification (e.g. disabled or all failed) — keep bare URLs in order.
  return fallbackUrls.map((url, order) => ({ url, order }));
}

/**
 * Build a candidate PropertyAd from the facet channels and validate it.
 * Returns the parsed ad on success, or `null` when even the required fields
 * cannot be produced. Mapping notes / validation issues are appended to
 * `warnings`.
 */
export function mapFacetsToPropertyAd(
  bag: FacetBag,
  warnings: string[]
): PropertyAd | null {
  const {
    generalInfo,
    price,
    location,
    measurements,
    counts,
    years,
    features,
    availability,
    energy,
    agentInfo,
  } = bag;

  // Required by the root schema.
  const name = generalInfo?.title?.trim() || "";
  const description = generalInfo?.description?.trim() || "";

  const pt = classifyPropertyType(generalInfo?.propertyType);
  if (!pt.matched) {
    warnings.push(
      `Could not classify property type from "${generalInfo?.propertyType ?? "∅"}"; defaulted to flat/flat.`
    );
  }

  // listingType + price / rent from the price facet.
  const listingType =
    price?.type === "purchase"
      ? "buy"
      : price?.type === "rental"
        ? "rent"
        : undefined;
  const ALLOWED_CURRENCIES = new Set(["CHF", "PLN"]);
  const currency: "CHF" | "PLN" =
    price?.currency && ALLOWED_CURRENCIES.has(price.currency.toUpperCase())
      ? (price.currency.toUpperCase() as "CHF" | "PLN")
      : "CHF";
  if (
    price?.currency &&
    !ALLOWED_CURRENCIES.has(price.currency.toUpperCase()) &&
    price.price != null
  ) {
    warnings.push(
      `Price currency ${price.currency} dropped (unsupported); defaulted to CHF.`
    );
  }
  const hasAmount = price?.price != null && !price?.priceOnRequest;

  // fundamentals — livingSpace & roomHeight are structurally required (value may be null).
  const fundamentals = compact({
    price:
      listingType === "buy" && hasAmount
        ? { amount: price!.price as number, currency }
        : undefined,
    availableFrom:
      availability?.date ||
      availability?.text ||
      availability?.raw ||
      undefined,
    livingSpace: toM2(measurements?.livingArea) ?? {
      value: null,
      unit: "m2" as const,
    },
    floor:
      counts?.floorNumber != null && counts.floorNumber >= 0
        ? counts.floorNumber
        : undefined,
    numberOfFloors:
      counts?.floors != null && counts.floors >= 1 ? counts.floors : undefined,
    usableArea: toM2(measurements?.usableArea),
    landArea: toM2(measurements?.landArea ?? measurements?.plotArea),
    houseVolume: toM3(measurements?.buildingVolume),
    rooms: counts?.rooms ?? undefined,
    yearOfConstruction: years?.yearOfConstruction ?? undefined,
    latestRenovations: years?.renovationYear ?? undefined,
    roomHeight: toM(measurements?.ceilingHeight) ?? {
      value: null,
      unit: "m" as const,
    },
    ceilingHeight: toM(measurements?.ceilingHeight),
    numberOfApartments: counts?.residentialUnits ?? undefined,
  });

  // equipment — `features` array is structurally required.
  const featureLabels: string[] = [];
  const pushFlag = (on: boolean | null | undefined, label: string) => {
    if (on) featureLabels.push(label);
  };
  pushFlag(features?.garden, "Garden");
  pushFlag(features?.dishwasher, "Dishwasher");
  pushFlag(features?.airConditioning, "Air conditioning");
  pushFlag(features?.swimmingPool, "Swimming pool");
  pushFlag(features?.furnished, "Furnished");
  for (const f of features?.additionalFeatures ?? []) featureLabels.push(f);

  const equipment = compact({
    landArea: toM2(measurements?.landArea ?? measurements?.plotArea),
    houseVolume: toM3(measurements?.buildingVolume),
    heating: classifyHeating(energy?.heatingType, energy?.energySource),
    balcony: toM2(measurements?.balconyArea),
    terrace: toM2(measurements?.terraceArea),
    basement: toM2(measurements?.basementArea),
    gardenArea: toM2(measurements?.gardenArea),
    numberOfGarageSpaces: counts?.garageSpaces ?? undefined,
    numberOfParkingSpaces: counts?.parkingSpaces ?? undefined,
    lift: features?.elevator ?? undefined,
    hasFireplace: features?.fireplace ?? undefined,
    petsPermitted: features?.petsAllowed ?? undefined,
    wheelchairAccessible: features?.wheelchairAccessible ?? undefined,
    minergie: /minergie-p/i.test(energy?.certificateType ?? "")
      ? ("minergie-p" as const)
      : /minergie-a/i.test(energy?.certificateType ?? "")
        ? ("minergie-a" as const)
        : undefined,
  });
  (equipment as Record<string, unknown>).features = featureLabels.map(
    (label) => ({ label })
  );

  const rent = compact({
    grossRent:
      listingType === "rent" && hasAmount
        ? { amount: price!.price as number, currency }
        : null,
  });

  // address & agent keys must be PRESENT (their inner fields are all optional).
  // deepCompact strips LLM-emitted nulls at every depth (e.g. agency.address.country)
  // that would otherwise fail the optional-but-not-nullable schema fields.
  const address = location
    ? deepCompact(location as Record<string, unknown>)
    : {};
  const agent = agentInfo
    ? deepCompact(agentInfo as Record<string, unknown>)
    : {};

  const candidate = {
    address,
    name,
    description,
    referenceNumber: undefined,
    sourceUrl: bag.pageURL,
    propertyTypeCategory: pt.propertyTypeCategory,
    propertyTypeSubcategory: pt.propertyTypeSubcategory,
    ...(listingType ? { listingType } : {}),
    ...(Object.keys(fundamentals).length > 0 ? { fundamentals } : {}),
    ...(Object.keys(equipment).length > 0 ? { equipment } : {}),
    images: bag.images ?? [],
    rent,
    agent,
    // Verbatim native payload (NOT deepCompacted — preserve the provider's item as-is).
    ...(bag.raw ? { raw: bag.raw } : {}),
  };

  const parsed = propertyAdSchema.safeParse(
    compact(candidate as Record<string, unknown>)
  );
  if (parsed.success) return parsed.data;

  warnings.push(
    `PropertyAd failed validation: ${parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`
  );
  return null;
}
