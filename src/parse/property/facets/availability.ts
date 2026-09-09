import { z } from "zod";

export const AvailabilitySchema = z.object({
  type: z
    .enum(["date", "text"])
    .nullable()
    .optional()
    .describe(
      "Whether availability is a concrete calendar date ('date') or free text such as immediately / by agreement ('text')"
    ),
  date: z
    .string()
    .nullable()
    .optional()
    .describe(
      "ISO 8601 date (YYYY-MM-DD) when a concrete availability date is given; null otherwise"
    ),
  text: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Textual availability when no concrete date is given (e.g. 'Immediately', 'Sofort', 'by agreement', 'nach Vereinbarung'); null otherwise"
    ),
  raw: z
    .string()
    .nullable()
    .optional()
    .describe("The availability exactly as stated on the page, verbatim"),
});

export type Availability = z.infer<typeof AvailabilitySchema>;

