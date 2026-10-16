import { claimDelivery, finishDeliveryFailure, reconcileExpiredDeliveryLeases } from "./recovery.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import { transaction } from "../shared/transaction.ts";
const payload = z.object({ entityId: z.uuid(), eventId: z.uuid().optional(), version: z.number().int().positive() }).strict();
export async function enqueueInvalidation(tx: Tx, key: string, data: z.input<typeof payload>) {
  return tx.outboxMessage.create({ data: { deduplicationKey: key, type: "DOMAIN_INVALIDATION", payload: payload.parse(data),eventId:data.eventId } });
}

export async function publishNextInvalidation(db: PrismaClient, publish: (message: string) => Promise<unknown>) {
  const owner = randomUUID(), now = new Date();
  await reconcileExpiredDeliveryLeases(db,now);
  const message=await transaction(db,tx=>claimDelivery(tx,["DOMAIN_INVALIDATION"],12,owner,now));
  if (!message) return "IDLE";
  try {
    payload.parse(message.payload);
    await publish(JSON.stringify({ type: "invalidate", scope: "portal" }));
    await db.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, lastFailureCode: null } });
    return "PUBLISHED";
  } catch {
    await finishDeliveryFailure(db,message.id,owner,message.attempts+1,12,"REALTIME_PUBLISH_FAILED");
    return "FAILED";
  }
}
