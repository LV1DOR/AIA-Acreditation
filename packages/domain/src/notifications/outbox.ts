import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
const payload = z.object({ entityId: z.uuid(), eventId: z.uuid().optional(), version: z.number().int().positive() }).strict();
export async function enqueueInvalidation(tx: Tx, key: string, data: z.input<typeof payload>) {
  return tx.outboxMessage.create({ data: { deduplicationKey: key, type: "DOMAIN_INVALIDATION", payload: payload.parse(data) } });
}

