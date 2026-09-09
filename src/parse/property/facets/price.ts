import { z } from "zod";

export const PriceSchema = z.object({
  type: z
    .enum(["purchase", "rental"])
    .nullable()
    .optional()
    .describe("Type of price (purchase = Kauf, rental = Miete)"),
  price: z
    .number()
    .nonnegative()
    .nullable()
    .optional()
    .describe("Price amount; null when the price is on request"),
  currency: z
    .string()
    .min(3)
    .max(3)
    .nullable()
    .optional()
    .describe("ISO 4217 currency code (e.g. CHF, EUR, USD)"),
  priceOnRequest: z
    .boolean()
    .describe(
      "True when the price is not published and is available on request (e.g. 'Preis auf Anfrage', 'price on request')"
    ),
});

export type Price = z.infer<typeof PriceSchema>;

