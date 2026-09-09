import { z } from "zod";

// Factories (not shared instances) so each field emits its own JSON Schema
// node — reusing one instance makes the converter emit a `$ref`, which
// OpenAI's strict structured-output mode rejects alongside a `description`.
const area = () =>
  z
    .object({
      value: z.number().nonnegative().describe("Numeric area value"),
      unit: z.literal("m²").describe("Area unit"),
    })
    .nullable()
    .optional();

const volume = () =>
  z
    .object({
      value: z.number().nonnegative().describe("Numeric volume value"),
      unit: z.literal("m³").describe("Volume unit"),
    })
    .nullable()
    .optional();

const length = () =>
  z
    .object({
      value: z.number().nonnegative().describe("Numeric length value"),
      unit: z.literal("m").describe("Length unit"),
    })
    .nullable()
    .optional();

export const MeasurementsSchema = z.object({
  // Areas (m²)
  livingArea: area().describe("Living area (Wohnfläche)"),
  gardenArea: area().describe("Garden area"),
  grossFloorArea: area().describe("Total gross floor area"),
  usableArea: area().describe("Usable or net floor area"),
  landArea: area().describe("Total land area"),
  plotArea: area().describe("Plot / lot area (Grundstücksfläche)"),
  builtUpArea: area().describe("Built-up / footprint area (bebaute Fläche)"),
  balconyArea: area().describe("Balcony area"),
  terraceArea: area().describe("Terrace area"),
  basementArea: area().describe("Basement area (Kellerfläche)"),
  atticArea: area().describe("Attic area"),
  storageArea: area().describe("Storage area"),
  officeArea: area().describe("Office / commercial area"),
  // Volumes (m³)
  buildingVolume: volume().describe(
    "Total building / house volume (Gebäudevolumen, Kubatur)"
  ),
  netVolume: volume().describe(
    "Total net / usable interior volume of the building (Nettovolumen), not per-room"
  ),
  // Lengths (m)
  ceilingHeight: length().describe("Ceiling / room height (Raumhöhe)"),
});

export type Measurements = z.infer<typeof MeasurementsSchema>;

