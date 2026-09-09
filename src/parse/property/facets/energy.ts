import { z } from "zod";

export const EnergySchema = z.object({
  energyClass: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Energy efficiency class / rating as stated (e.g. 'A', 'B', 'GEAK C')"
    ),
  certificateType: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Type of energy certificate or standard (e.g. 'GEAK', 'Energieausweis', 'MINERGIE', 'EPC')"
    ),
  heatingType: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Heating system type (e.g. 'Wärmepumpe / heat pump', 'Fussbodenheizung / underfloor', 'Radiatoren')"
    ),
  energySource: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Energy source / carrier used for heating (e.g. 'Gas', 'Öl / oil', 'Fernwärme / district heating', 'Solar', 'Holz / wood')"
    ),
  consumption: z
    .object({
      value: z
        .number()
        .nonnegative()
        .describe("Numeric energy consumption / demand value"),
      unit: z
        .string()
        .describe("Unit of the consumption value (e.g. 'kWh/m²a')"),
    })
    .nullable()
    .optional()
    .describe("Energy consumption or demand, when a figure is given"),
  certificateValidUntil: z
    .string()
    .nullable()
    .optional()
    .describe(
      "ISO 8601 date (YYYY-MM-DD) the energy certificate is valid until, when stated"
    ),
});

export type Energy = z.infer<typeof EnergySchema>;

