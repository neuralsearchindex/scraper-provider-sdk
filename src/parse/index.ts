/**
 * Deterministic parsing helpers shared across catalog providers — pulled out of the central scraper
 * so a standalone catalog depends only on this SDK. Import from `@neuralsearchindex/scraper-provider-sdk/parse`.
 */
export * from "./next-data";
export * from "./jsonld-vehicle";
export * from "./sitemap";
export * from "./next-rsc";
export * from "./html-facets";
export * from "./jsonld-property";
export type { VehicleAd } from "./vehicle-ad";

// Property-ad shapes + the facet type system (also re-exported from the SDK root for providers that
// import them the way they did from the central `provider.interface`).
export * from "./property/facet-types";
export type {
  PropertyAd,
  PropertyAdImage,
  ClassifiedImage,
  Address,
  Agent,
  Rent,
  Fundamentals,
  Equipment,
  NearbyAmenity,
} from "./property/property-ad.schema";
export { mapFacetsToPropertyAd, classifyHeating, compact, deepCompact, type FacetBag } from "./property/assemble";
export { classifyPropertyType, type PropertyType } from "./property/property-type";
