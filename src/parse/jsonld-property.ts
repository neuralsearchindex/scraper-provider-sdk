/**
 * Shared deterministic facet extractor for **immomig**-hosted real-estate portals
 * (home-visit.ch, martharuf.ch, valimmobilier.ch, …). Every immomig detail page embeds
 * the listing as a schema.org `Offer` JSON-LD node whose `itemOffered` carries the full
 * property (address, geo, areas, rooms, amenities, photos) and whose `seller` (or a
 * sibling `Organization`/`RealEstateAgent` node) carries the agency. This maps that JSON
 * to the property `FacetOutputs` — no HTML parsing, no LLM.
 *
 * A single `immomigFacets()` returns a ready-to-spread `facets` table; drop it into any
 * immomig provider. The parse is memoised single-slot by page HTML, so the ~9 facet
 * mappers over one page share one JSON-LD harvest.
 */
import { harvestJsonLd } from "../engine";
import type { DetailExtractor, ProviderPageInput } from "../contract";
import { facetsToDetails } from "./html-facets";
import type { PropertyAdImage } from "./property/property-ad.schema";
import type {
  CapabilityResult,
  FacetExtractors,
  FacetKey,
  FacetOutputs,
} from "./property/facet-types";

/** The immomig `Offer` JSON-LD provider hook (unified {@link DetailExtractor}). */
export function immomigDetails(): DetailExtractor {
  return facetsToDetails(immomigFacets());
}

/** The generic schema.org `RealEstateListing`/`Residence` provider hook. */
export function schemaOrgPropertyDetails(): DetailExtractor {
  return facetsToDetails(schemaOrgPropertyFacets());
}

// --- schema.org shapes (only the fields we read) ---

type MaybeArr<T> = T | T[] | null | undefined;

interface SchemaAddress {
  streetAddress?: string;
  addressLocality?: string;
  postalCode?: string;
  addressRegion?: string;
  addressCountry?: string;
}
interface SchemaAmenity {
  name?: string;
  value?: string | boolean;
}
interface SchemaItemOffered {
  "@type"?: string | string[];
  address?: SchemaAddress;
  geo?: { latitude?: number | string; longitude?: number | string };
  floorSize?: { value?: number | string; unitCode?: string };
  numberOfRooms?: number | string;
  numberOfBedrooms?: number | string;
  numberOfBathroomsTotal?: number | string;
  floorLevel?: number | string;
  yearBuilt?: number | string;
  amenityFeature?: SchemaAmenity[];
  photo?: MaybeArr<string | { url?: string; contentUrl?: string }>;
}
interface SchemaAgent {
  name?: string;
  logo?: string | { url?: string };
  image?: string | { url?: string };
  telephone?: string;
  email?: string;
  address?: SchemaAddress;
}
interface SchemaOffer {
  name?: string;
  description?: string;
  businessFunction?: string;
  price?: number | string;
  priceCurrency?: string;
  itemOffered?: SchemaItemOffered;
  seller?: SchemaAgent;
}

// --- JSON-LD node discovery ---

/** Flatten harvested JSON-LD nodes, expanding any `@graph` containers. */
function flattenNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of harvestJsonLd(html)) {
    if (!node || typeof node !== "object") continue;
    const graph = (node as Record<string, unknown>)["@graph"];
    if (Array.isArray(graph)) {
      for (const g of graph) if (g && typeof g === "object") out.push(g as Record<string, unknown>);
    } else {
      out.push(node as Record<string, unknown>);
    }
  }
  return out;
}

/** True when a node's `@type` is (or includes) `type`. */
function typeMatches(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

/** The `Offer` (with `itemOffered`) + its agency node, or `null` if the page has none. */
export function findImmomigOffer(
  html: string
): { offer: SchemaOffer; agency: SchemaAgent | null } | null {
  const nodes = flattenNodes(html);
  const offer = nodes.find((n) => typeMatches(n, "Offer") && n.itemOffered) as
    | SchemaOffer
    | undefined;
  if (!offer) return null;
  const agency =
    offer.seller ??
    (nodes.find(
      (n) => typeMatches(n, "RealEstateAgent") || typeMatches(n, "Organization")
    ) as SchemaAgent | undefined) ??
    null;
  return { offer, agency };
}

// --- scalar helpers ---

/** A finite number from a number or numeric string, else null. */
function num(v: number | string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** schema.org `addressCountry` → the facet country enum (default CH). */
function country(raw?: string): "CH" | "DE" | "PL" {
  const s = (raw ?? "").toLowerCase();
  if (s.startsWith("de") || s.includes("german") || s.includes("deutsch")) return "DE";
  if (s.startsWith("pl") || s.includes("pol")) return "PL";
  return "CH";
}
/** Split "Lehngasse 27" → { street, houseNumber }; no trailing number → all street. */
function splitStreet(streetAddress?: string): { street: string; houseNumber: string } {
  const s = (streetAddress ?? "").trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)*)$/);
  return m ? { street: m[1].trim(), houseNumber: m[2] } : { street: s, houseNumber: "" };
}
/** An `{ value, unit:"m²" }` area, or null. */
function area(v: number | string | undefined | null): { value: number; unit: "m²" } | null {
  const n = num(v);
  return n != null ? { value: n, unit: "m²" } : null;
}
function logoUrl(v?: string | { url?: string }): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : (v.url ?? null);
}

// --- amenity → feature mapping (DE / FR / IT keyword match) ---

const FEATURE_KEYWORDS: Array<[keyof FacetOutputs["features"], string[]]> = [
  ["balcony", ["balkon", "balcon", "balcone"]],
  ["terrace", ["terrasse", "terrazza", "terrazzo"]],
  ["garden", ["garten", "jardin", "giardino"]],
  ["elevator", ["lift", "aufzug", "ascenseur", "ascensore", "elevator"]],
  ["garage", ["garage", "einstellhalle", "einstellhallenplatz", "box "]],
  ["parking", ["parkplatz", "parking", "stellplatz", "posto auto", "autoabstellplatz"]],
  ["cellar", ["keller", "cave", "cantina"]],
  ["fireplace", ["cheminée", "cheminee", "kamin", "camino"]],
  ["dishwasher", ["geschirrspüler", "geschirrspuler", "lave-vaisselle", "lavastoviglie", "spülmaschine"]],
  ["airConditioning", ["klimaanlage", "klimatisiert", "climatisation", "aria condizionata", "air condition"]],
  ["swimmingPool", ["schwimmbad", "piscine", "piscina", "pool"]],
  ["wheelchairAccessible", ["rollstuhl", "behindertengerecht", "barrierefrei", "accessible", "fauteuil roulant"]],
  ["furnished", ["möbliert", "moebliert", "meublé", "meuble", "arredato", "furnished"]],
  ["petsAllowed", ["haustiere", "tiere erlaubt", "animaux", "animali", "pets allowed"]],
];

/** Map an amenity's text to a condition enum, or null. */
function conditionFrom(text: string): FacetOutputs["generalInfo"]["condition"] {
  const s = text.toLowerCase();
  if (/neubau|im bau|en construction|under construction|in costruzione/.test(s)) return "under_construction";
  if (/sanierungsbedürftig|à rénover|a rénover|da ristrutturare|needs renov/.test(s)) return "needs_renovation";
  if (/neuwertig|\bneu\b|nuovo|neuf|\bnew\b/.test(s)) return "new";
  if (/renoviert|saniert|rénové|rénovée|ristrutturato|renovated/.test(s)) return "renovated";
  if (/gepflegt|bien entretenu|ben tenuto|well.?maintained|soigné/.test(s)) return "well_maintained";
  return null;
}

// --- the mapped bundle (one parse per page, memoised) ---

type ImmomigFacets = Pick<
  FacetOutputs,
  | "generalInfo"
  | "price"
  | "location"
  | "measurements"
  | "counts"
  | "years"
  | "features"
  | "agent"
  | "images"
>;

let cachedSrc: string | null = null;
let cachedOut: ImmomigFacets | null = null;

/** Map an immomig detail page's `Offer` JSON-LD to property facets (memoised by html). */
export function mapImmomig(html: string): ImmomigFacets | null {
  if (html === cachedSrc) return cachedOut;
  cachedSrc = html;
  cachedOut = null;

  const found = findImmomigOffer(html);
  if (!found) return null;
  const { offer, agency } = found;
  const item = offer.itemOffered ?? {};
  const addr = item.address ?? {};

  // features + condition from amenityFeature[]
  const features: FacetOutputs["features"] = { additionalFeatures: null };
  const extras: string[] = [];
  let condition: FacetOutputs["generalInfo"]["condition"] = null;
  for (const a of item.amenityFeature ?? []) {
    const text = `${a?.name ?? ""} ${typeof a?.value === "string" ? a.value : ""}`.trim();
    if (!text) continue;
    condition ??= conditionFrom(text);
    const low = text.toLowerCase();
    const hit = FEATURE_KEYWORDS.find(([, kws]) => kws.some((k) => low.includes(k)));
    if (hit) (features as Record<string, unknown>)[hit[0]] = true;
    else if (typeof a?.value === "string" && a.value.trim()) extras.push(a.value.trim());
  }
  if (extras.length) features.additionalFeatures = [...new Set(extras)];

  const { street, houseNumber } = splitStreet(addr.streetAddress);
  const coordinates: { lat?: number; lon?: number } = {};
  const lat = num(item.geo?.latitude);
  const lon = num(item.geo?.longitude);
  if (lat != null) coordinates.lat = lat;
  if (lon != null) coordinates.lon = lon;

  const price = num(offer.price);
  const floorLevel = num(item.floorLevel);

  // photos → images
  const photos = Array.isArray(item.photo) ? item.photo : item.photo != null ? [item.photo] : [];
  const seenImg = new Set<string>();
  const images: PropertyAdImage[] = [];
  for (const p of photos) {
    const url = typeof p === "string" ? p : (p?.url ?? p?.contentUrl);
    if (!url || seenImg.has(url)) continue;
    seenImg.add(url);
    images.push({ url, order: images.length });
  }

  const agencyAddr = agency?.address;

  cachedOut = {
    generalInfo: {
      title: offer.name ?? null,
      description: offer.description ?? null,
      propertyType: (Array.isArray(item["@type"]) ? item["@type"][0] : item["@type"]) ?? null,
      condition,
    },
    price: {
      type: /lease|rent/i.test(offer.businessFunction ?? "") ? "rental" : "purchase",
      price,
      currency: offer.priceCurrency ?? null,
      priceOnRequest: price == null,
    },
    location: {
      country: country(addr.addressCountry),
      street,
      houseNumber,
      postalCode: addr.postalCode ?? "",
      city: addr.addressLocality ?? "",
      state: addr.addressRegion ?? "",
      coordinates,
    },
    measurements: {
      // immomig `floorSize` is always the living area in m² (unitCode "m2"/"MTK").
      livingArea: area(item.floorSize?.value),
    },
    counts: {
      rooms: num(item.numberOfRooms),
      bedrooms: num(item.numberOfBedrooms),
      bathrooms: num(item.numberOfBathroomsTotal),
      // immomig sometimes puts an internal code (e.g. "500") in floorLevel — keep only
      // plausible human floor numbers.
      floorNumber: floorLevel != null && floorLevel >= -5 && floorLevel <= 40 ? floorLevel : null,
    },
    years: { yearOfConstruction: num(item.yearBuilt) },
    features,
    agent: {
      agency: {
        name: agency?.name ?? null,
        image: logoUrl(agency?.logo) ?? logoUrl(agency?.image),
        phoneNumber: agency?.telephone ?? null,
        emailAddress: agency?.email ?? null,
        ...(agencyAddr
          ? {
              address: {
                country: country(agencyAddr.addressCountry),
                ...splitStreet(agencyAddr.streetAddress),
                postalCode: agencyAddr.postalCode ?? "",
                city: agencyAddr.addressLocality ?? "",
              },
            }
          : {}),
      },
      agent: {},
    },
    images,
  };
  return cachedOut;
}

// ---------------------------------------------------------------------------
// Generic schema.org listing mapper — for portals that embed a direct
// `RealEstateListing`/`Residence`/`Apartment`/`House`/`Product` node (with `offers`)
// rather than the immomig `Offer.itemOffered` shape. Best-effort over standard fields.
// ---------------------------------------------------------------------------

interface SchemaListingNode extends SchemaItemOffered {
  name?: string;
  description?: string;
  price?: number | string;
  priceCurrency?: string;
  image?: MaybeArr<string | { url?: string; contentUrl?: string }>;
  offers?: MaybeArr<{ price?: number | string; priceCurrency?: string; businessFunction?: string }>;
}

/** Find a direct schema.org real-estate listing node + an agency node. */
export function findSchemaListing(
  html: string
): { item: SchemaListingNode; agency: SchemaAgent | null } | null {
  const nodes = flattenNodes(html);
  const re = /Residence|Apartment|House|RealEstateListing|SingleFamilyResidence|Accommodation|Product/;
  const item = nodes.find((n) => re.test(String(n["@type"] ?? ""))) as SchemaListingNode | undefined;
  if (!item) return null;
  const agency =
    (nodes.find((n) => typeMatches(n, "RealEstateAgent") || typeMatches(n, "Organization")) as
      | SchemaAgent
      | undefined) ?? null;
  return { item, agency };
}

let cachedGenericSrc: string | null = null;
let cachedGeneric: ImmomigFacets | null = null;

/** Map a direct schema.org listing node to property facets (memoised by html). */
export function mapSchemaOrgProperty(html: string): ImmomigFacets | null {
  if (html === cachedGenericSrc) return cachedGeneric;
  cachedGenericSrc = html;
  cachedGeneric = null;

  const found = findSchemaListing(html);
  if (!found) return null;
  const { item, agency } = found;
  const addr = item.address ?? {};
  const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
  const price = num(offer?.price ?? item.price);

  const { street, houseNumber } = splitStreet(addr.streetAddress);
  const coordinates: { lat?: number; lon?: number } = {};
  const lat = num(item.geo?.latitude);
  const lon = num(item.geo?.longitude);
  if (lat != null) coordinates.lat = lat;
  if (lon != null) coordinates.lon = lon;

  const features: FacetOutputs["features"] = { additionalFeatures: null };
  const extra: string[] = [];
  for (const a of item.amenityFeature ?? []) {
    const text = `${a?.name ?? ""} ${typeof a?.value === "string" ? a.value : ""}`.trim();
    if (!text) continue;
    const hit = FEATURE_KEYWORDS.find(([, kws]) => kws.some((k) => text.toLowerCase().includes(k)));
    if (hit) (features as Record<string, unknown>)[hit[0]] = true;
    else if (typeof a?.value === "string" && a.value.trim()) extra.push(a.value.trim());
  }
  if (extra.length) features.additionalFeatures = [...new Set(extra)];

  const photos = Array.isArray(item.image) ? item.image : item.image != null ? [item.image] : [];
  const seenImg = new Set<string>();
  const images: PropertyAdImage[] = [];
  for (const p of photos) {
    const url = typeof p === "string" ? p : (p?.url ?? p?.contentUrl);
    if (!url || seenImg.has(url)) continue;
    seenImg.add(url);
    images.push({ url, order: images.length });
  }

  cachedGeneric = {
    generalInfo: {
      title: item.name ?? null,
      description: item.description ?? null,
      propertyType: (Array.isArray(item["@type"]) ? item["@type"][0] : item["@type"]) ?? null,
      condition: null,
    },
    price: {
      type: /lease|rent/i.test(offer?.businessFunction ?? "") ? "rental" : "purchase",
      price,
      currency: offer?.priceCurrency ?? item.priceCurrency ?? null,
      priceOnRequest: price == null,
    },
    location: {
      country: country(addr.addressCountry),
      street,
      houseNumber,
      postalCode: addr.postalCode ?? "",
      city: addr.addressLocality ?? "",
      state: addr.addressRegion ?? "",
      coordinates,
    },
    measurements: { livingArea: area(item.floorSize?.value) },
    counts: {
      rooms: num(item.numberOfRooms),
      bedrooms: num(item.numberOfBedrooms),
      bathrooms: num(item.numberOfBathroomsTotal),
    },
    years: { yearOfConstruction: num(item.yearBuilt) },
    features,
    agent: {
      agency: {
        name: agency?.name ?? null,
        image: logoUrl(agency?.logo) ?? logoUrl(agency?.image),
        phoneNumber: agency?.telephone ?? null,
        emailAddress: agency?.email ?? null,
      },
      agent: {},
    },
    images,
  };
  return cachedGeneric;
}

/** A ready-to-spread `facets` table backed by {@link mapSchemaOrgProperty}. */
export function schemaOrgPropertyFacets(): FacetExtractors {
  const keys: (keyof ImmomigFacets)[] = [
    "generalInfo",
    "price",
    "location",
    "measurements",
    "counts",
    "years",
    "features",
    "agent",
    "images",
  ];
  const facet =
    <K extends keyof ImmomigFacets>(key: K) =>
    async ({ html, fullHtml }: ProviderPageInput): Promise<CapabilityResult<FacetOutputs[K]>> => ({
      data: (mapSchemaOrgProperty(fullHtml ?? html)?.[key] ?? null) as FacetOutputs[K] | null,
      warnings: [],
    });
  const out: FacetExtractors = {};
  for (const k of keys) (out as Record<FacetKey, unknown>)[k] = facet(k);
  return out;
}

/**
 * A ready-to-spread `facets` table for an immomig provider. Each facet reads the page's
 * memoised `Offer` mapping; a page with no immomig `Offer` yields `null` per facet.
 */
export function immomigFacets(): FacetExtractors {
  const facet =
    <K extends keyof ImmomigFacets>(key: K) =>
    async ({ html, fullHtml }: ProviderPageInput): Promise<CapabilityResult<FacetOutputs[K]>> => {
      const mapped = mapImmomig(fullHtml ?? html);
      return { data: (mapped?.[key] ?? null) as FacetOutputs[K] | null, warnings: [] };
    };

  const keys: (keyof ImmomigFacets)[] = [
    "generalInfo",
    "price",
    "location",
    "measurements",
    "counts",
    "years",
    "features",
    "agent",
    "images",
  ];
  const out: FacetExtractors = {};
  for (const k of keys) (out as Record<FacetKey, unknown>)[k] = facet(k);
  // Preserve the native immomig `Offer` JSON verbatim on the ad's `raw` field.
  out.raw = async ({ html, fullHtml }: ProviderPageInput): Promise<CapabilityResult<FacetOutputs["raw"]>> => {
    const found = findImmomigOffer(fullHtml ?? html);
    return { data: (found?.offer ?? null) as FacetOutputs["raw"] | null, warnings: [] };
  };
  return out;
}
