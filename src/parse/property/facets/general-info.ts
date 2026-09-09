import { z } from "zod";

export const GeneralInfoSchema = z.object({
  title: z
    .string()
    .nullable()
    .optional()
    .describe("Listing title / headline of the advertisement"),
  description: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Full descriptive text of the property as written in the listing (the main description body)"
    ),
  summary: z
    .string()
    .nullable()
    .optional()
    .describe("A short one- or two-sentence summary of the property"),
  propertyType: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Type of property as stated (e.g. 'apartment / Wohnung', 'house / Einfamilienhaus', 'villa', 'studio', 'commercial')"
    ),
  condition: z
    .enum([
      "new",
      "renovated",
      "well_maintained",
      "needs_renovation",
      "under_construction",
    ])
    .nullable()
    .optional()
    .describe("Overall condition / state of the property"),
});

export type GeneralInfo = z.infer<typeof GeneralInfoSchema>;

