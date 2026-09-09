import { z } from "zod";

// --- Enums (aligned with property-ad-schema.json) ---

export const countryCodeSchema = z
  .enum(["CH", "DE", "PL"])
  .describe("Country code.");

export const listingTypeSchema = z
  .enum(["rent", "buy"])
  .describe("Whether the ad is for rental or sale.");

export const propertyTypeCategorySchema = z
  .enum(["house", "flat", "furnished-property", "parking", "commercial"])
  .describe("Main property category.");

export const propertyTypeSubcategorySchema = z
  .enum([
    "detached-house",
    "villa",
    "semi-detached-house",
    "terraced-house",
    "terrace-house",
    "multi-family-house",
    "farmhouse",
    "chalet",
    "rustico",
    "building-plot",
    "flat",
    "penthouse-flat",
    "roof-flat",
    "terrace-flat",
    "maisonette-duplex",
    "single-room",
    "studio",
    "loft",
    "furnished-house",
    "furnished-flat",
    "parking-space",
    "garage",
    "underground-car-park",
    "practice-rooms",
    "office-space",
    "retail-space",
    "warehouse",
    "hobby-room",
    "restaurant",
    "hotel",
  ])
  .describe(
    "Subcategory per property type; see propertyTypeSubcategoryEnum for allowed values per category."
  );

export const conditionSchema = z
  .enum([
    "new-build",
    "as-new",
    "freshly-renovated",
    "new-or-recently-renovated",
    "ready-to-move-in",
    "period",
  ])
  .describe("Condition of the property.");

export const heatingSchema = z
  .enum([
    "gas",
    "oil",
    "heat-pump",
    "geothermal",
    "pellet",
    "district-heating",
    "electric",
  ])
  .describe("Heating type.");

export const fireplaceSchema = z
  .enum(["open-fireplace", "swedish-stove"])
  .describe("Fireplace type.");

export const internetAccessSchema = z
  .enum(["copper", "fibre", "cable"])
  .describe("Internet access type.");

export const minergieSchema = z
  .enum(["minergie-p", "minergie-a", "eco"])
  .describe("Minergie certification.");

export const imageTypeSchema = z
  .enum(["exterior", "interior", "floor-plan", "other"])
  .describe("Image category.");

export const imageRoomSchema = z
  .enum([
    "bedroom",
    "kitchen",
    "bathroom",
    "living-room",
    "dining-room",
    "hallway",
    "balcony",
    "terrace",
    "garden",
    "garage",
    "basement",
    "other",
  ])
  .describe("Room or area shown (for interior/exterior photos).");

/**
 * Zero-shot classifier confidence, one sigmoid probability per chosen label.
 * Emitted by apps/siglip-classifier and persisted alongside the labels so a
 * gate can be re-tuned later without re-running the model.
 *
 * NOTE: SigLIP image classification is OUT OF SCOPE for apps/scraper — these
 * bits are kept so the schema stays 1:1 with the source, but the scraper never
 * populates `type`/`room`/`meta`.
 */
export const imageClassificationMetaSchema = z
  .object({
    room_score: z
      .number()
      .describe("Confidence the room label is correct (0–1)."),
    type_score: z
      .number()
      .describe("Confidence the type label is correct (0–1)."),
  })
  .strict();

export type ImageClassificationMeta = z.infer<
  typeof imageClassificationMetaSchema
>;

/**
 * One photo as the SigLIP classifier (apps/siglip-classifier) returns it.
 * `type`/`room`/`meta` are null when the photo could not be fetched or encoded —
 * callers keep the slot so ordering stays aligned with the input URLs.
 *
 * NOTE: SigLIP image classification is OUT OF SCOPE for apps/scraper; this type
 * is retained for schema parity only.
 */
export const classifiedImageSchema = z
  .object({
    url: z.string().describe("Image URL."),
    type: imageTypeSchema
      .nullable()
      .describe("Image category, or null on failure."),
    room: imageRoomSchema
      .nullable()
      .describe("Room shown (interiors only), or null."),
    meta: imageClassificationMetaSchema
      .nullable()
      .describe("Per-label confidence, or null."),
  })
  .strict();

export type ClassifiedImage = z.infer<typeof classifiedImageSchema>;

// --- Reusable value+unit objects ---

const valueUnitM2Schema = z
  .object({
    value: z.number().min(0).nullable(),
    unit: z.enum(["m2"]),
  })
  .strict();

const valueUnitMSchema = z
  .object({
    value: z.number().min(0).nullable(),
    unit: z.enum(["m"]),
  })
  .strict();

const valueUnitM3Schema = z
  .object({
    value: z.number().min(0).nullable(),
    unit: z.enum(["m3"]),
  })
  .strict();

// --- Address ---

export const addressSchema = z
  .object({
    country: countryCodeSchema,
    street: z.string().describe("Street name."),
    houseNumber: z.string().describe("House number."),
    postalCode: z.string().describe("PLZ / Postal code."),
    city: z.string().describe("City."),
    state: z
      .string()
      .describe("State (optional). Use empty string if not applicable."),
    coordinates: z
      .object({
        lat: z.number().optional().describe("Latitude."),
        lon: z.number().optional().describe("Longitude."),
      })
      .describe("Coordinates of the property."),
    displayName: z.string().optional().describe("Display name."),
    tags: z.array(z.string()).optional().describe("Tags."),
  })
  .strict()
  .describe("Address of the property (on the ad).");

// --- Fundamentals ---

const priceSchema = z
  .object({
    amount: z.number().min(0).describe("Numeric amount."),
    currency: z.enum(["CHF", "PLN"]).default("CHF"),
  })
  .strict()
  .describe("Price (currency + amount).");

const amountCurrencySchema = z
  .object({
    amount: z.number().min(0),
    currency: z.enum(["CHF", "PLN"]),
  })
  .strict();

const optionalString = () => z.string().default("");
const optionalNumber = (min?: number, max?: number) => {
  let s = z.number().int();
  if (min !== undefined) s = s.min(min) as typeof s;
  if (max !== undefined) s = s.max(max) as typeof s;
  return s.optional();
};

const optionalLatestRenovations = () =>
  z
    .union([
      z.number().int().min(1000).max(2100),
      z.array(z.number().int()),
      z.literal(null),
    ])
    .default(null);

export const fundamentalsSchema = z
  .object({
    price: priceSchema.optional(),
    availableFrom: optionalString().describe("Available from (date)."),
    livingSpace: valueUnitM2Schema.describe("Living space (amount + m²)."),
    floor: optionalNumber(0).describe(
      "Floor number. Used for Flat and Commercial. Only set when explicitly mentioned in source (e.g. 'Erdgeschoss', '2. Stock', '3rd floor'). Never default to 0."
    ),
    numberOfFloors: optionalNumber(1).describe(
      "Number of floors. Used for Flat and Commercial."
    ),
    usableArea: valueUnitM2Schema
      .optional()
      .describe("Usable area (m²). Used for Commercial."),
    landArea: valueUnitM2Schema.optional().describe("Land / plot area (m²)."),
    houseVolume: valueUnitM3Schema.optional().describe("House volume (m³)."),
    number: optionalNumber(1).describe("Number of units. Used for Parking."),
    rooms: z
      .number()
      .min(0)
      .optional()
      .describe("Number of rooms (e.g. 1, 1.5, 2, 2.5, 3, 3.5, 4)."),
    yearOfConstruction: optionalNumber(1000, 2100).describe(
      "Year of construction."
    ),
    condition: conditionSchema
      .optional()
      .describe("Condition of the property."),
    latestRenovations: optionalLatestRenovations().describe(
      "Latest renovations (year or list of years)."
    ),
    coOwnershipShare: z
      .string()
      .regex(/^[0-9]+\/1000$/)
      .or(z.literal(""))
      .default("")
      .describe(
        "Co-ownership share (e.g. 250/1000). Used for Flat. Empty if not applicable."
      ),
    roomHeight: valueUnitMSchema.describe(
      "Room height in metres. Used for Commercial."
    ),
    ceilingHeight: valueUnitMSchema
      .optional()
      .describe("Clear ceiling height (m) — warehouse Deckenhöhe."),
    numberOfApartments: optionalNumber(0).describe(
      "Number of apartments — Mehrfamilienhaus."
    ),
  })
  .strict()
  .describe("Fundamentals of the property.");

export const featureUnitSchema = z.enum([
  "m²",
  "m³",
  "year",
  "count",
  "letter",
]);

/**
 * Listing feature. Three shapes supported during migration:
 * - `{ slug, value?, unit? }` — preferred (new pipeline; closed-vocab catalog match).
 * - `{ label, value?, unit? }` — legacy indexed docs OR LLM free-form fallback.
 * - `{ slug, label, value?, unit? }` — catalog hit with a brand/qualifier the mapper keeps.
 *
 * Renderer prefers slug when present; falls back to raw label otherwise.
 */
export const featureSchema = z
  .object({
    slug: z.string().optional(),
    label: z.string().optional(),
    value: z.union([z.number(), z.string()]).optional(),
    unit: featureUnitSchema.optional(),
  })
  .strict()
  .refine((f) => f.slug != null || f.label != null, {
    message: "Feature must have either `slug` or `label`.",
  })
  .describe(
    "Feature — slug from catalog (preferred) or free-form label (fallback)."
  );

export const nearbyAmenitySchema = z.object({
  name: z.string().optional().describe("Name of the amenity."),
  type: z.string().describe("Type of the amenity."),
  coordinates: z
    .object({
      lat: z.number().optional().describe("Latitude of the amenity."),
      lon: z.number().optional().describe("Longitude of the amenity."),
    })
    .describe("Coordinates of the amenity."),
});

// --- Equipment ---
export const equipmentSchema = z
  .object({
    landArea: valueUnitM2Schema.optional().describe("Land area (m²)."),
    houseVolume: valueUnitM3Schema.optional().describe("House volume (m³)."),
    heating: heatingSchema.optional().describe("Heating type."),
    hobbyRoom: valueUnitM2Schema.optional().describe("Hobby room (m²)."),
    balcony: valueUnitM2Schema.optional().describe("Balcony (m²)."),
    terrace: valueUnitM2Schema.optional().describe("Terrace (m²)."),
    wintergarden: valueUnitM2Schema.optional().describe("Winter garden (m²)."),
    pergola: z.boolean().optional().describe("Pergola."),
    numberOfGarageSpaces: optionalNumber(0).describe(
      "Number of garage spaces."
    ),
    numberOfParkingSpaces: optionalNumber(0).describe(
      "Number of parking spaces."
    ),
    basement: valueUnitM2Schema.optional().describe("Basement (m²)."),
    cellarCompartment: valueUnitM2Schema
      .optional()
      .describe("Cellar compartment. Used for Flat."),
    esterich: valueUnitM2Schema.optional().describe("Esterich / storage (m²)."),
    esterichCompartment: valueUnitM2Schema
      .optional()
      .describe("Esterich compartment. Used for Flat."),
    reduit: valueUnitM2Schema.optional().describe("Reduit / storage (m²)."),
    lift: z.boolean().optional().describe("Lift."),
    fireplace: fireplaceSchema
      .optional()
      .describe("Fireplace type (open-fireplace, swedish-stove)."),
    hasFireplace: z
      .boolean()
      .optional()
      .describe(
        "Whether the property has a fireplace (use when type is unknown)."
      ),
    internetAccess: internetAccessSchema
      .optional()
      .describe("Internet access type."),
    minergie: minergieSchema.optional().describe("Minergie certification."),
    petsPermitted: z
      .boolean()
      .optional()
      .describe("Pets permitted. Relevant for rent."),
    view: z.boolean().optional().describe("View."),
    wheelchairAccessible: z
      .boolean()
      .optional()
      .describe("Wheelchair accessible."),
    quietLocation: z.boolean().optional().describe("Quiet location."),
    childFriendly: z.boolean().optional().describe("Child-friendly."),
    gardenArea: valueUnitM2Schema
      .optional()
      .describe("Garden area (m²) — Reiheneinfamilienhaus / Doppelhaus."),
    roomConcept: z
      .enum(["open", "divided"])
      .optional()
      .describe("Floor-plan concept — Loft."),
    accessType: z
      .enum(["ramp", "gate", "both"])
      .optional()
      .describe("Warehouse access — ramp / sectional gate / both."),
    hasStorage: z
      .boolean()
      .optional()
      .describe("Retail storage room presence."),
    seats: optionalNumber(0).describe("Restaurant / hospitality seat count."),
    driveHeight: valueUnitMSchema
      .optional()
      .describe(
        "Parking drive-through / clearance height in metres. 'Durchfahrtshöhe', 'Einfahrtshöhe', 'Höhe Einfahrt'. Applies to Tiefgaragenplatz / Box."
      ),
    evCharging: z
      .enum(["yes", "prepared", "no"])
      .optional()
      .describe(
        "EV charging readiness. 'yes' when present, 'prepared' when wired/ducted but not installed, 'no' when explicitly absent. 'E-Ladestation', 'Elektroladestation', 'Ladestation', 'E-Ladeanschluss vorbereitet'. Applies to all parking subtypes."
      ),
    isCovered: z
      .boolean()
      .optional()
      .describe(
        "Outdoor parking spot is roofed / sheltered. 'überdacht', 'überdachter Parkplatz', 'Carport'. Applies to Aussenplatz only."
      ),
    nearbyAmenities: z
      .array(nearbyAmenitySchema)
      .optional()
      .describe("Nearby amenities."),
    features: z
      .array(featureSchema)
      .describe(
        "Features. Examples: 'Year of Construction: 2015', 'Plot Size: 385 m²', 'Cubage (Volume): 896 m³', 'Hobby Room: 21 m²', 'Terrace: 9 m²', 'Outdoor Seating Area: 15 m²', 'Garage: 2 (spaces)', 'Outdoor Parking Spaces: 3', 'Pergola', 'Gas Heating'."
      ),
  })
  .strict()
  .describe("Equipment and features.");

// --- Images ---

export const propertyAdImageSchema = z
  .object({
    url: z.string().describe("Image URL."),
    order: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Display order (0-based)."),
    type: imageTypeSchema
      .optional()
      .describe("Image category (from apps/siglip-classifier)."),
    room: imageRoomSchema
      .optional()
      .describe("Room or area shown (interiors only)."),
    meta: imageClassificationMetaSchema
      .optional()
      .describe("Per-label classifier confidence."),
  })
  .strict();

// --- Rent (when listingType is 'rent') ---

const optionalAmountCurrency = () =>
  z.union([amountCurrencySchema, z.literal(null)]).default(null);

export const rentSchema = z
  .object({
    netRent: optionalAmountCurrency().describe("Net rent."),
    additionalCosts: optionalAmountCurrency().describe("Additional costs."),
    grossRent: optionalAmountCurrency().describe("Gross rent."),
  })
  .strict()
  .describe("Rent-specific fields (only when listingType is 'rent').");

// --- Agent ---

export const agentSchema = z
  .object({
    agency: z.object({
      name: z
        .string()
        .nullable()
        .optional()
        .describe("Name of the real estate agency"),
      image: z
        .string()
        .nullable()
        .optional()
        .describe("Absolute URL of the agency's logo or image"),
      address: addressSchema
        .omit({ coordinates: true, displayName: true, tags: true })
        .partial()
        .nullable()
        .optional()
        .describe("Postal address of the agency"),
      phoneNumber: z
        .string()
        .nullable()
        .optional()
        .describe("Phone number of the agency"),
      emailAddress: z
        .string()
        .nullable()
        .optional()
        .describe("Email address of the agency"),
    }),
    agent: z.object({
      name: z
        .string()
        .nullable()
        .optional()
        .describe("Full name of the listing agent"),
      image: z
        .string()
        .nullable()
        .optional()
        .describe("Absolute URL of the agent's photo"),
      phoneNumber: z
        .string()
        .nullable()
        .optional()
        .describe("Phone number of the listing agent"),
      emailAddress: z
        .string()
        .nullable()
        .optional()
        .describe("Email address of the listing agent"),
    }),
  })
  .describe("Information about the listing agent and agency.");

// --- Root: Property Ad ---
export const propertyAdSchema = z
  .object({
    address: addressSchema
      .partial()
      .describe("Address of the property (on the ad)."),
    name: z.string().describe("Ad headline or listing title."),
    description: z.string().describe("Main ad text or body."),
    additionalInformation: optionalString().describe(
      "Additional information (e.g. notes, disclaimers, extra details)."
    ),
    language: z
      .enum(["de", "en", "fr"])
      .optional()
      .describe("Language of the ad content (ISO 639-1)."),
    referenceNumber: optionalString().describe(
      "Portal or agency reference number (e.g. Referenznummer, Objektnummer)."
    ),
    sourceUrl: optionalString().describe(
      "URL of the original listing (e.g. portal or agency page)."
    ),
    publishedAt: optionalString().describe(
      "When the ad was first published (ISO 8601)."
    ),
    updatedAt: optionalString().describe(
      "When the ad was last updated (ISO 8601)."
    ),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags or keywords (e.g. for search or LLM context)."),
    listingType: listingTypeSchema.optional(),
    propertyTypeCategory: propertyTypeCategorySchema,
    propertyTypeSubcategory: propertyTypeSubcategorySchema,
    fundamentals: fundamentalsSchema.strict().optional(),
    equipment: equipmentSchema.strict().optional(),
    images: z
      .array(propertyAdImageSchema)
      .default([])
      .describe("Images attached to the listing."),
    rent: rentSchema
      .partial()
      .optional()
      .default({})
      .describe("Rent-specific fields (only when listingType is 'rent')."),
    agent: agentSchema.partial().describe("Information about agent."),
    raw: z
      .record(z.unknown())
      .optional()
      .describe(
        "Full provider-native listing payload (fields not mapped to this schema)."
      ),
    pageContent: optionalString().describe(
      "The listing's original detail page as Markdown (deterministic HTML→Markdown via markdownService.toMarkdown). Attached at assemble time, not LLM-extracted."
    ),
  })
  .strict()
  .describe(
    "Real estate property advertisement (rent or buy): property categories, fundamentals, equipment, and agent information."
  );

export type PropertyAd = z.infer<typeof propertyAdSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Fundamentals = z.infer<typeof fundamentalsSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type PropertyAdImage = z.infer<typeof propertyAdImageSchema>;
export type Rent = z.infer<typeof rentSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type NearbyAmenity = z.infer<typeof nearbyAmenitySchema>;
