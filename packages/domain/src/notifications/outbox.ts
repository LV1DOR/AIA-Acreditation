import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import { transaction } from "../shared/transaction.ts";
const payload = z.object({ entityId: z.uuid(), eventId: z.uuid().optional(), version: z.number().int().positive() }).strict();
export async function enqueueInvalidation(tx: Tx, key: string, data: z.input<typeof payload>) {
  return tx.outboxMessage.create({ data: { deduplicationKey: key, type: "DOMAIN_INVALIDATION", payload: payload.parse(data) } });
}

export async function publishNextInvalidation(db: PrismaClient, publish: (message: string) => Promise<unknown>) {
  const owner = randomUUID(), now = new Date();
  const message = await transaction(db, async tx => {
    const where = { type: "DOMAIN_INVALIDATION", processedAt: null, attempts: { lt: 12 }, availableAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] };
    const row = await tx.outboxMessage.findFirst({ where, orderBy: [{ availableAt: "asc" }, { id: "asc" }] });
    if (!row) return null;
    const claimed = await tx.outboxMessage.updateMany({ where: { ...where, id: row.id }, data: { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + 60000), attempts: { increment: 1 } } });
    return claimed.count ? row : null;
  });
  if (!message) return "IDLE";
  try {
    payload.parse(message.payload);
    await publish(JSON.stringify({ type: "invalidate", scope: "portal" }));
    await db.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, lastFailureCode: null } });
    return "PUBLISHED";
  } catch {
    const attempts = message.attempts + 1;
    await db.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { leaseOwner: null, leaseExpiresAt: null, availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 1000), lastFailureCode: attempts >= 12 ? "REALTIME_PUBLISH_FAILED_FINAL" : "REALTIME_PUBLISH_FAILED", ...(attempts >= 12 ? { payload: {} } : {}) } });
    return "FAILED";
  }
}
