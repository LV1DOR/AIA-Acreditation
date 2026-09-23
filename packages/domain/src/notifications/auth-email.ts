import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { encryptEmail, decryptEmail, type EmailTransport } from "@aia/email";
import { transaction } from "../shared/transaction.ts";
import type { Tx } from "../shared/transaction.ts";
const email = z.object({
  deliveryId: z.uuid(), to: z.email(), subject: z.string().min(1).max(200),
  text: z.string().min(1).max(500000), html: z.string().min(1).max(500000)
}).strict();
const eventInput = z.object({
  eventId: z.string().min(1).max(200), recipient: z.email(),
  subject: z.string().min(1).max(200), text: z.string().min(1).max(500000), html: z.string().min(1).max(500000),
}).strict();
export async function queueEncryptedEmail(tx: Tx, type: "AUTH_EMAIL" | "LEADER_INVITATION_EMAIL", deduplicationKey: string, raw: z.input<typeof eventInput>, key: string) {
  const input = eventInput.parse(raw), id = randomUUID();
  const payload = encryptEmail({ deliveryId: id, to: input.recipient, subject: input.subject, text: input.text, html: input.html }, key, id);
  const created = await tx.outboxMessage.createMany({ data: [{ id, type, deduplicationKey, payload }], skipDuplicates: true });
  if (created.count) await tx.auditEvent.create({ data: { actorType: "SYSTEM", action: type === "AUTH_EMAIL" ? "AUTH_EMAIL_QUEUED" : "LEADER_INVITATION_EMAIL_QUEUED", entityType: "OutboxMessage", entityId: id, correlationId: randomUUID(), metadata: {} } });
  return { queued: created.count === 1 };
}
// Call only after verifying the provider signature. No raw provider event is persisted.
export async function enqueueAuthEmail(db: PrismaClient, raw: z.input<typeof eventInput>, key: string) {
  const input = eventInput.parse(raw);
  const deduplicationKey = "clerk-email:" + createHash("sha256").update(input.eventId).digest("hex");
  return transaction(db, tx => queueEncryptedEmail(tx, "AUTH_EMAIL", deduplicationKey, input, key));
}
export async function deliverNextAuthEmail(db: PrismaClient, transport: EmailTransport, key: string) {
  const owner = randomUUID(), now = new Date();
  const message = await transaction(db, async tx => {
    const where = { type: { in: ["AUTH_EMAIL", "LEADER_INVITATION_EMAIL"] }, processedAt: null, attempts: { lt: 8 }, availableAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] };
    const row = await tx.outboxMessage.findFirst({ where, orderBy: [{ availableAt: "asc" }, { id: "asc" }] });
    if (!row) return null;
    const claimed = await tx.outboxMessage.updateMany({ where: { ...where, id: row.id }, data: { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + 60000), attempts: { increment: 1 } } });
    return claimed.count ? row : null;
  });
  if (!message) return "IDLE";
  try {
    await transport.send(email.parse(decryptEmail(message.payload, key, message.id)));
    await transaction(db, async tx => {
      const completed = await tx.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, lastFailureCode: null } });
      if (completed.count) await tx.auditEvent.create({ data: { actorType: "SYSTEM", action: message.type === "AUTH_EMAIL" ? "AUTH_EMAIL_SENT" : "LEADER_INVITATION_EMAIL_SENT", entityType: "OutboxMessage", entityId: message.id, correlationId: randomUUID(), metadata: {} } });
    });
    return "SENT";
  } catch {
    const attempts = message.attempts + 1;
    await db.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: {
      leaseOwner: null, leaseExpiresAt: null,
      availableAt: new Date(Date.now() + Math.min(300, 2 ** attempts) * 1000),
      lastFailureCode: attempts >= 8 ? "EMAIL_DELIVERY_FAILED_FINAL" : "EMAIL_DELIVERY_FAILED",
      ...(attempts >= 8 ? { payload: {} } : {}),
    } });
    return "FAILED";
  }
}
