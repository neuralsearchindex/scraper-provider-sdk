/**
 * Shared deterministic vehicle extractor for portals that embed a schema.org `Car`
 * (or `["Product","Car"]` / `Vehicle`) JSON-LD node on their detail pages (aaaauto.pl,
 * superauto.pl, autohero.com, …) — plus an optional `AutoDealer`/`Organization` seller
 * node. Maps both to the `VehicleAd` shape (with the generic `agent`/`agency`), no LLM.
 *
 * `schemaOrgVehicleDetails()` returns a ready-to-use `extractDetails` hook; drop it into
 * any such provider. Enum words are matched multilingually (PL/DE/EN); quantities are
 * read whether the site encodes them as `{ value, unitCode }` objects OR free-text
 * strings (`"147 578 KMT"`, `"150 KM / 110 kW"`), and emissions (CO₂ / Euro class /
 * consumption) are parsed from their labelled free-text fields — so one mapper serves
 * several markets and JSON-LD dialects.
 */
import { harvestJsonLd } from "../engine";
import type { DetailExtraction, DetailExtractor, ProviderPageInput } from "../contract";
import type { VehicleAd } from "./vehicle-ad";

// --- schema.org shapes (only the fields we read) ---

interface Quantity {
  value?: number | string;
  unitCode?: string;
  unitText?: string;
}
/**
 * A schema.org quantity as sites encode it in practice: the canonical
 * `{ value, unitCode }` object, or a plain string/number (e.g. autohero's
 * `"147 578 KMT"` / `"150 KM / 110 kW"`). {@link qtyValue} normalizes it.
 */
type QuantityLike = Quantity | number | string;

/** The schema.org `Car`/`Vehicle` node subset we read (fields vary by portal). */
export interface CarNode {
  "@type"?: string | string[];
  name?: string;
  brand?: { name?: string } | string;
  model?: string;
  vehicleConfiguration?: string;
  vehicleModelDate?: number | string;
  /** Some portals date-stamp the first registration instead of a model year. */
  dateVehiclefirstregistered?: number | string;
  mileageFromOdometer?: QuantityLike;
  fuelType?: string;
  bodyType?: string;
  /** Some portals (aacar) label the body style `vehicleBodyType` instead of `bodyType`. */
  vehicleBodyType?: string;
  vehicleTransmission?: string;
  driveWheelConfiguration?: string;
  vehicleEngine?: {
    fuelType?: string;
    enginePower?: QuantityLike;
    engineDisplacement?: QuantityLike;
  };
  color?: string;
  /** Fallback colour field some portals (autohero) use for the body colour. */
  vehicleInteriorColor?: string;
  seatingCapacity?: number | string;
  numberOfDoors?: number | string;
  vehicleIdentificationNumber?: string;
  /** Dealer/portal stock number (schema.org `sku`), mapped to `referenceNumber`. */
  sku?: string;
  /** Free-text emission fields: `"CO2: 127 g/km"`, `"Klasa emisji: EURO 6"`, `"5.1 l/100 km"`. */
  emissionsCO2?: string;
  meetsEmissionStandard?: string;
  fuelConsumption?: string;
  image?: string[] | string;
  offers?:
    | { price?: number | string; priceCurrency?: string; url?: string }
    | Array<{ price?: number | string; priceCurrency?: string; url?: string }>;
  url?: string;
}

/** The `AutoDealer`/`Organization` seller node subset. */
export interface DealerNode {
  "@type"?: string | string[];
  name?: string;
  url?: string;
  telephone?: string;
  email?: string;
  logo?: string | { url?: string };
  address?: {
    streetAddress?: string;
    postalCode?: string;
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
  };
}

// --- JSON-LD node discovery ---

function flatten(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const node of harvestJsonLd(html)) {
    if (!node || typeof node !== "object") continue;
    const graph = (node as { "@graph"?: unknown })["@graph"];
    if (Array.isArray(graph)) {
      for (const g of graph) if (g && typeof g === "object") out.push(g as Record<string, unknown>);
    } else {
      out.push(node as Record<string, unknown>);
    }
  }
  return out;
}
const typeText = (node: Record<string, unknown>): string => JSON.stringify(node["@type"] ?? "");

/** Find the schema.org `Car`/`Vehicle` node in the page's JSON-LD. */
export function findCarNode(html: string): CarNode | null {
  return (flatten(html).find((n) => /Car|Vehicle/.test(typeText(n))) as CarNode | undefined) ?? null;
}

/** Find the `AutoDealer`/`Organization` seller node in the page's JSON-LD. */
export function findDealerNode(html: string): DealerNode | null {
  return (
    (flatten(html).find((n) => /AutoDealer|CarDealer|Organization/.test(typeText(n))) as
      | DealerNode
      | undefined) ?? null
  );
}

// --- scalar helpers ---

function num(v: number | string | undefined | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
/** The scalar of a {@link QuantityLike}: the object's `value`, else the string/number itself. */
function qtyValue(q: QuantityLike | undefined): number | string | undefined {
  if (q == null) return undefined;
  return typeof q === "object" ? q.value : q;
}
/** First 4-digit year (19xx/20xx) in a year/date value (`2016`, `"2025"`, `"2022-06"`). */
function yearOf(v: number | string | undefined): number | undefined {
  if (v == null) return undefined;
  const m = String(v).match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : undefined;
}
/** CO₂ g/km from a free-text field like `"CO2: 127 g/km"` (the number before `g`). */
function co2Of(s: string | undefined): number | undefined {
  const m = s?.match(/([\d.,]+)\s*g/i);
  return m ? num(m[1]) : undefined;
}
/** Emission class from `"Klasa emisji: EURO 6"` / `"euro6d"` → `"Euro 6"` / `"Euro 6d"`. */
function emissionClassOf(s: string | undefined): string | undefined {
  const m = s?.match(/euro\s*\d[a-z+]*/i);
  return m ? m[0].replace(/euro\s*/i, "Euro ").replace(/\s+/g, " ").trim() : undefined;
}
/** Combined l/100km from `"5.1 l/100 km"` (the first litre figure). */
function consumptionOf(s: string | undefined): number | undefined {
  const m = s?.match(/([\d]+(?:[.,]\d+)?)\s*l/i);
  return m ? num(m[1].replace(",", ".")) : undefined;
}
/** Map a localized enum word to a schema value (substring match), else undefined. */
function mapWord(raw: string | undefined, table: Array<[string[], string]>): string | undefined {
  const s = (raw ?? "").toLowerCase();
  if (!s) return undefined;
  for (const [kws, v] of table) if (kws.some((k) => s.includes(k))) return v;
  return undefined;
}
function dropEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

// Multilingual (PL / DE / EN) enum tables — order matters (plugin before hybrid).
const FUEL: Array<[string[], string]> = [
  [["plug-in", "plugin", "wtyczk"], "plugin-hybrid"],
  [["mhev", "mild"], "mhev"],
  [["hybryd", "hybrid"], "hybrid"],
  [["diesel"], "diesel"],
  [["benzyn", "petrol", "benzin", "gasoline"], "petrol"],
  [["elektr", "electric", "elektro"], "electric"],
  [["lpg", "autogas"], "lpg"],
  [["cng", "erdgas"], "cng"],
  [["wodór", "wodor", "hydrogen", "wasserstoff"], "hydrogen"],
];
const TRANS: Array<[string[], string]> = [
  [["automat", "dsg", "s tronic", "tiptronic"], "automatic"],
  [["manual", "ręczn", "reczn", "manuell", "schalt"], "manual"],
];
const BODY: Array<[string[], string]> = [
  [["kombi", "estate", "combi", "avant", "touring"], "estate"],
  [["sedan", "limuzyna", "limousine", "saloon"], "sedan"],
  [["hatchback"], "hatchback"],
  [["suv", "terenowy", "geländ", "gelaend", "crossover", "offroad"], "suv"],
  [["coupe", "coupé"], "coupe"],
  [["kabriolet", "cabrio", "convertible", "roadster"], "convertible"],
  [["minivan", "van", "kombivan", "bus"], "van"],
  [["pickup", "pick-up"], "pickup"],
];
const COLOR: Array<[string[], string]> = [
  [["szar", "grau", "gray", "grey"], "gray"],
  [["czarn", "schwarz", "black"], "black"],
  [["biał", "bial", "weiss", "weiß", "white"], "white"],
  [["srebr", "silber", "silver"], "silver"],
  [["niebiesk", "blau", "blue"], "blue"],
  [["czerwon", "rot", "red"], "red"],
  [["zielon", "grün", "gruen", "green"], "green"],
  [["brązow", "brazow", "braun", "brown"], "brown"],
  [["beżow", "bezow", "beige"], "beige"],
  [["żółt", "zolt", "gelb", "yellow"], "yellow"],
  [["pomarańcz", "pomarancz", "orange"], "orange"],
  [["złot", "zlot", "gold"], "gold"],
  [["fiolet", "violet", "purple", "lila"], "purple"],
];
const DRIVE: Array<[string[], string]> = [
  [["allwheel", "all-wheel", "4matic", "quattro", "allrad", "awd", "4x2 all"], "awd"],
  [["fourwheel", "four-wheel", "4x4", "4wd"], "4x4"],
  [["frontwheel", "front-wheel", "front", "przedni", "vorderrad", "fwd", "4x2"], "fwd"],
  [["rearwheel", "rear-wheel", "rear", "tyln", "hinterrad", "rwd"], "rwd"],
];

/** Absolute image URLs from the Car node, deduped. */
export function carImages(car: CarNode): string[] {
  const imgs = Array.isArray(car.image) ? car.image : car.image ? [car.image] : [];
  return [...new Set(imgs.filter((u): u is string => typeof u === "string" && !!u))];
}

/**
 * Engine power → { powerHp?, powerKw? }. Handles the canonical `{ value, unitCode }`
 * object (unit decides hp vs kW) AND a free-text string like `"150 KM / 110 kW"`
 * (both figures parsed). BHP / HP / PS / KM (Polish "koni mechanicznych") → metric hp.
 */
function power(q?: QuantityLike): { powerHp?: number; powerKw?: number } {
  if (q == null) return {};
  if (typeof q === "object") {
    const v = num(q.value);
    if (v == null) return {};
    const unit = `${q.unitCode ?? ""} ${q.unitText ?? ""}`.toLowerCase();
    return /kw/.test(unit) ? { powerKw: v } : { powerHp: v };
  }
  const s = String(q);
  const out: { powerHp?: number; powerKw?: number } = {};
  const kw = s.match(/([\d.,]+)\s*kw/i);
  if (kw) out.powerKw = num(kw[1]);
  const hp = s.match(/([\d.,]+)\s*(?:km|ps|hp|bhp|koni)\b/i);
  if (hp) out.powerHp = num(hp[1]);
  return out;
}

/** Map a schema.org `Car` node to the vehicle-ad shape (condition derived from mileage). */
export function mapCarNodeToVehicle(car: CarNode): VehicleAd {
  const offer = Array.isArray(car.offers) ? car.offers[0] : car.offers;
  const make = typeof car.brand === "string" ? car.brand : car.brand?.name;
  const price = num(offer?.price);
  const mileageKm = num(qtyValue(car.mileageFromOdometer));
  const firstReg = car.dateVehiclefirstregistered;
  // variant: the explicit config, else the name with a leading "make model" stripped.
  let variant = car.vehicleConfiguration?.trim() || undefined;
  if (!variant && car.name) {
    const rest = car.name.replace(new RegExp(`^\\s*${make ?? ""}\\s*${car.model ?? ""}\\s*`, "i"), "").trim();
    variant = rest && rest !== car.name ? rest.replace(/^[,\s]+/, "") : undefined;
  }

  return dropEmpty({
    make,
    model: car.model != null ? String(car.model) : undefined,
    variant,
    title: car.name,
    vin: car.vehicleIdentificationNumber,
    referenceNumber: car.sku,
    year: yearOf(car.vehicleModelDate ?? firstReg),
    firstRegistration: typeof firstReg === "string" ? firstReg : undefined,
    mileageKm,
    fuelType: mapWord(car.fuelType ?? car.vehicleEngine?.fuelType, FUEL),
    transmission: mapWord(car.vehicleTransmission, TRANS),
    drivetrain: mapWord(car.driveWheelConfiguration ?? car.name ?? car.vehicleConfiguration, DRIVE),
    ...power(car.vehicleEngine?.enginePower),
    engineDisplacementCc: num(qtyValue(car.vehicleEngine?.engineDisplacement)),
    doors: num(car.numberOfDoors),
    seats: num(car.seatingCapacity),
    color: mapWord(car.color ?? car.vehicleInteriorColor, COLOR),
    // 0 km ⇒ new (leasing/new-car portals), otherwise used.
    condition: mileageKm != null && mileageKm > 0 ? "used" : "new",
    sellerType: "dealer",
    bodyType:
      mapWord(car.bodyType ?? car.vehicleBodyType, BODY) ??
      (car.bodyType ?? car.vehicleBodyType)?.trim().toLowerCase(),
    co2Gpkm: co2Of(car.emissionsCO2),
    emissionClass: emissionClassOf(car.meetsEmissionStandard),
    fuelConsumptionLp100: consumptionOf(car.fuelConsumption),
    price: price != null ? dropEmpty({ amount: price, currency: offer?.priceCurrency }) : undefined,
    sourceUrl: car.url ?? offer?.url,
  });
}

/** Map an `AutoDealer`/`Organization` node to the generic vehicle `agent` (agency). */
export function mapDealerToAgent(dealer: DealerNode): VehicleAd["agent"] | undefined {
  const image = typeof dealer.logo === "string" ? dealer.logo : dealer.logo?.url;
  const a = dealer.address;
  const agency = dropEmpty({
    name: dealer.name,
    image,
    website: dealer.url,
    phoneNumber: dealer.telephone,
    emailAddress: dealer.email,
    address: dropEmpty({
      street: a?.streetAddress,
      postalCode: a?.postalCode,
      city: a?.addressLocality,
      state: a?.addressRegion,
      country: a?.addressCountry,
    }),
  });
  return Object.keys(agency).length > 0 ? { agency } : undefined;
}

/** A ready-to-use `extractDetails` hook for a schema.org `Car` JSON-LD detail page. */
export function schemaOrgVehicleDetails(): DetailExtractor {
  return async (input: ProviderPageInput): Promise<DetailExtraction> => {
    const html = input.fullHtml ?? input.html;
    const car = findCarNode(html);
    if (!car) return { ad: null, warnings: ["no schema.org Car JSON-LD on page"] };
    const ad = mapCarNodeToVehicle(car);
    const dealer = findDealerNode(html);
    const agent = dealer ? mapDealerToAgent(dealer) : undefined;
    if (agent) ad.agent = agent;
    return {
      ad: ad as unknown as Record<string, unknown>,
      images: carImages(car),
      raw: car as unknown as Record<string, unknown>,
      warnings: [],
    };
  };
}
