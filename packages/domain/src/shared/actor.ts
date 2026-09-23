import { z } from "zod";
export const actorSchema = z.object({
  clerkUserId: z.string().min(1).max(200),
  correlationId: z.uuid(),
}).strict();
// Only server authentication adapters may construct this context; never accept it from request bodies.
export type ActorContext = z.infer<typeof actorSchema>;
