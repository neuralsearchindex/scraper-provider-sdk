import { z } from "zod";
import { agentSchema } from "../property-ad.schema";

// The canonical agent/agency shape lives in the shared property-ad schema.
export const AgentInfoSchema = agentSchema;

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

