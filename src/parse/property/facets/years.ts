import { z } from "zod";

// Factory (not a shared instance) so each field emits its own JSON Schema
// node — reusing one instance makes the converter emit a `$ref`, which
// OpenAI's strict structured-output mode rejects alongside a `description`.
const year = () => z.number().int().min(1000).max(2100).nullable().optional();

export const YearsSchema = z.object({
  yearOfConstruction: year().describe(
    "Year the building was originally constructed (Baujahr)"
  ),
  renovationYear: year().describe(
    "Year of the most recent renovation (Renovationsjahr / letzte Renovation)"
  ),
});

export type Years = z.infer<typeof YearsSchema>;

