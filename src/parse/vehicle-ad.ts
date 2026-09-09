/**
 * The scraped-car shape catalog providers produce — a faithful structural port of the central
 * scraper's `VehicleAd` (`reader/lib/extract/structured/vehicle/vehicle-ad.schema`), as plain TS so a
 * standalone catalog carries no zod/schema dependency. Deliberately loose (free-string
 * classification fields the engine normalizes at ingest); the catalog worker hands it back over the
 * wire as `Record<string, unknown>`.
 */

export interface VehiclePrice {
  amount?: number;
  currency?: string;
  net?: number;
  vatDeductible?: boolean;
  monthlyRate?: number;
  downPayment?: number;
  contractMonths?: number;
  annualMileageLimitKm?: number;
}

export interface VehicleAddress {
  city?: string;
  state?: string;
  country?: string;
  displayName?: string;
  postalCode?: string;
  street?: string;
}

/** A seller contact — the selling dealer/agency (business) or the individual salesperson. */
export interface VehicleContact {
  name?: string;
  image?: string;
  phoneNumber?: string;
  emailAddress?: string;
  website?: string;
  address?: VehicleAddress;
}

export interface VehicleAgent {
  agency?: VehicleContact;
  agent?: VehicleContact;
}

export interface VehicleAd {
  // identity
  make?: string;
  model?: string;
  variant?: string;
  title?: string;
  description?: string;
  vin?: string;
  referenceNumber?: string;
  language?: string;
  // classification
  bodyType?: string;
  listingType?: string;
  condition?: string;
  sellerType?: string;
  // powertrain
  fuelType?: string;
  transmission?: string;
  drivetrain?: string;
  powerHp?: number;
  powerKw?: number;
  engineDisplacementCc?: number;
  cylinders?: number;
  torqueNm?: number;
  gears?: number;
  // EV / hybrid
  batteryKwh?: number;
  electricRangeKm?: number;
  // body / interior
  doors?: number;
  seats?: number;
  color?: string;
  interiorColor?: string;
  interiorMaterial?: string;
  finish?: string;
  // history / condition / emissions
  year?: number;
  firstRegistration?: string;
  previousOwners?: number;
  mileageKm?: number;
  serviceBook?: boolean;
  accidentFree?: boolean;
  co2Gpkm?: number;
  emissionClass?: string;
  fuelConsumptionLp100?: number;
  electricConsumptionKwhp100?: number;
  // pricing / location
  price?: VehiclePrice;
  address?: VehicleAddress;
  // seller
  agent?: VehicleAgent;
  // equipment
  featureKeywords?: string[];
  // source
  sourceUrl?: string;
  publishedAt?: string;
  updatedAt?: string;
  // Extra provider-specific fields are allowed (the engine normalizes at ingest). The index
  // signature also makes a VehicleAd assignable to `DetailExtraction.ad` (Record<string, unknown>).
  [key: string]: unknown;
}
