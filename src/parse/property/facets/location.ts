import { z } from "zod";
import { addressSchema } from "../property-ad.schema";

export const LocationSchema = addressSchema.omit({
  tags: true,
  displayName: true,
});

export type Location = z.infer<typeof LocationSchema>;

