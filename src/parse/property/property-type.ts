/**
 * Free-text property-type to canonical category / subcategory enums.
 * Inlined from @neuralsearchindex/sdk-node/schemas/property-type so the app does not
 * depend on the workspace package.
 */
import { type PropertyAd } from "./property-ad.schema";

export interface PropertyType {
  propertyTypeCategory: PropertyAd["propertyTypeCategory"];
  propertyTypeSubcategory: PropertyAd["propertyTypeSubcategory"];
  matched: boolean;
}

export function classifyPropertyType(raw?: string | null): PropertyType {
  const s = (raw ?? "").toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => s.includes(k));

  if (has("furnished", "möbliert", "moebliert")) {
    return {
      propertyTypeCategory: "furnished-property",
      propertyTypeSubcategory: has("house", "haus")
        ? "furnished-house"
        : "furnished-flat",
      matched: true,
    };
  }
  if (
    has(
      "parking",
      "parkplatz",
      "garage",
      "tiefgarage",
      "stellplatz",
      "einstellhalle"
    )
  ) {
    return {
      propertyTypeCategory: "parking",
      propertyTypeSubcategory: has("tiefgarage", "underground", "einstellhalle")
        ? "underground-car-park"
        : has("garage", "box")
          ? "garage"
          : "parking-space",
      matched: true,
    };
  }
  if (
    has(
      "commercial",
      "gewerbe",
      "office",
      "büro",
      "buero",
      "retail",
      "laden",
      "warehouse",
      "lager",
      "restaurant",
      "hotel",
      "praxis",
      "practice"
    )
  ) {
    const sub = has("retail", "laden", "verkauf")
      ? "retail-space"
      : has("warehouse", "lager")
        ? "warehouse"
        : has("restaurant")
          ? "restaurant"
          : has("hotel")
            ? "hotel"
            : has("praxis", "practice")
              ? "practice-rooms"
              : "office-space";
    return {
      propertyTypeCategory: "commercial",
      propertyTypeSubcategory: sub,
      matched: true,
    };
  }
  if (
    has(
      "house",
      "haus",
      "villa",
      "chalet",
      "rustico",
      "einfamilien",
      "reihen",
      "doppelhaus",
      "mehrfamilien",
      "bauernhaus",
      "farmhouse"
    )
  ) {
    const sub = has("villa")
      ? "villa"
      : has("chalet")
        ? "chalet"
        : has("rustico")
          ? "rustico"
          : has("reihen", "terraced", "terrace-house")
            ? "terraced-house"
            : has("doppelhaus", "semi")
              ? "semi-detached-house"
              : has("mehrfamilien", "multi-family", "multifamily")
                ? "multi-family-house"
                : has("bauernhaus", "farmhouse")
                  ? "farmhouse"
                  : "detached-house";
    return {
      propertyTypeCategory: "house",
      propertyTypeSubcategory: sub,
      matched: true,
    };
  }
  if (
    has(
      "flat",
      "apartment",
      "wohnung",
      "studio",
      "loft",
      "penthouse",
      "maisonette",
      "duplex",
      "attika"
    )
  ) {
    const sub = has("studio")
      ? "studio"
      : has("loft")
        ? "loft"
        : has("penthouse", "attika")
          ? "penthouse-flat"
          : has("maisonette", "duplex")
            ? "maisonette-duplex"
            : has("terrasse", "terrace-flat")
              ? "terrace-flat"
              : "flat";
    return {
      propertyTypeCategory: "flat",
      propertyTypeSubcategory: sub,
      matched: true,
    };
  }

  // Unclassifiable — the root schema still needs both fields.
  return {
    propertyTypeCategory: "flat",
    propertyTypeSubcategory: "flat",
    matched: false,
  };
}
