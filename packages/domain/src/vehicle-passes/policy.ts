import { z } from "zod";
export const vehicleRequestSchema = z.discriminatedUnion("required", [
  z.object({ required: z.literal(false), requestedQuantity: z.literal(0), justification: z.null() }).strict(),
  z.object({ required: z.literal(true), requestedQuantity: z.number().int().positive().max(100000), justification: z.string().trim().min(1).max(4000) }).strict(),
]);

