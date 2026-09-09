import { z } from "zod";

// Factory (not a shared instance) so each field emits its own JSON Schema
// node — reusing one instance makes the converter emit a `$ref`, which
// OpenAI's strict structured-output mode rejects alongside a `description`.
// null = not mentioned, true = stated present, false = stated absent.
const flag = (feature: string) =>
  z
    .boolean()
    .nullable()
    .optional()
    .describe(`Whether the property has ${feature} (null if not mentioned)`);

export const FeaturesSchema = z.object({
  balcony: flag("a balcony"),
  terrace: flag("a terrace"),
  garden: flag("a garden"),
  elevator: flag("an elevator / lift"),
  parking: flag("an outdoor parking space"),
  garage: flag("a garage or covered parking"),
  cellar: flag("a cellar / basement storage"),
  fireplace: flag("a fireplace or wood stove"),
  dishwasher: flag("a dishwasher"),
  airConditioning: flag("air conditioning"),
  swimmingPool: flag("a swimming pool"),
  wheelchairAccessible: flag("wheelchair / barrier-free access"),
  furnished: flag("furnishings (is let/sold furnished)"),
  petsAllowed: flag("a pets-allowed policy"),
  additionalFeatures: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      "Any other notable features or amenities mentioned that are not covered by the boolean fields"
    ),
});

export type Features = z.infer<typeof FeaturesSchema>;

