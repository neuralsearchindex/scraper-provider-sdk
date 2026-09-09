import { z } from "zod";

// Factory (not a shared instance) so each field emits its own JSON Schema
// node — reusing one instance makes the converter emit a `$ref`, which
// OpenAI's strict structured-output mode rejects alongside a `description`.
const count = () => z.number().int().nonnegative().nullable().optional();

export const CountsSchema = z.object({
  residentialUnits: count().describe(
    "Number of residential units (e.g. apartments or houses)"
  ),
  floors: count().describe("Number of floors in the building"),
  floorNumber: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe(
      "Floor the unit is located on (0 = ground floor, negative = basement)"
    ),
  rooms: z
    .number()
    .nonnegative()
    .multipleOf(0.5)
    .nullable()
    .optional()
    .describe(
      "Total number of rooms; may be a half value for Swiss/German listings (e.g. 3.5 Zimmer)"
    ),
  bedrooms: count().describe("Number of bedrooms"),
  bathrooms: count().describe("Number of bathrooms"),
  guestToilets: count().describe("Number of guest toilets / WCs"),
  kitchens: count().describe("Number of kitchens"),
  parkingSpaces: count().describe(
    "Number of outdoor / uncovered parking spaces"
  ),
  garageSpaces: count().describe("Number of garage / covered parking spaces"),
});

export type Counts = z.infer<typeof CountsSchema>;

