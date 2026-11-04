import { claimDelivery, finishDeliveryFailure, reconcileExpiredDeliveryLeases, authDeliveryStillValid } from "./recovery.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { encryptEmail, decryptEmail, type EmailTransport } from "@aia/email";
import { transaction } from "../shared/transaction.ts";
import type { Tx } from "../shared/transaction.ts";
import { emailQueueContext, recordEmailRecipient, recordEmailSent } from "./email-monitoring.ts";
const email = z.object({
  deliveryId: z.uuid(), to: z.email(), subject: z.string().min(1).max(200),
  text: z.string().min(1).max(500000), html: z.string().min(1).max(500000)
}).strict();
const eventInput = z.object({
  eventId: z.string().min(1).max(200), recipient: z.email(),
  subject: z.string().min(1).max(200), text: z.string().min(1).max(500000), html: z.string().min(1).max(500000), registrationId:z.uuid().optional(), scopeEventId:z.uuid().optional(),
}).strict();
export async function queueEncryptedEmail(tx: Tx, type: "AUTH_EMAIL" | "LEADER_INVITATION_EMAIL", deduplicationKey: string, raw: z.input<typeof eventInput>, key: string) {
  const input = eventInput.parse(raw), id = randomUUID();
  const payload = encryptEmail({ deliveryId: id, to: input.recipient, subject: input.subject, text: input.text, html: input.html }, key, id);
  const created = await tx.outboxMessage.createMany({ data: [{ id, type, deduplicationKey, payload, registrationId:input.registrationId,eventId:input.scopeEventId }], skipDuplicates: true });
  if (created.count) await tx.emailDelivery.create({ data: { outboxMessageId: id, recipients: [input.recipient.trim().toLowerCase()], category: type, ...await emailQueueContext(tx,{registrationId:input.registrationId,eventId:input.scopeEventId}), recipientHash: createHash("sha256").update(input.recipient.trim().toLowerCase()).digest("hex") } });
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
  await reconcileExpiredDeliveryLeases(db,now);
  const message=await transaction(db,tx=>claimDelivery(tx,["AUTH_EMAIL","LEADER_INVITATION_EMAIL"],8,owner,now));
  if (!message) return "IDLE";
  try {
    if(!await authDeliveryStillValid(db,message)) {await finishDeliveryFailure(db,message.id,owner,message.attempts+1,8,"AUTH_CAPABILITY_EXPIRED",true);return "FAILED";}
    const prepared = email.parse(decryptEmail(message.payload, key, message.id));
    await recordEmailRecipient(db, message.id, prepared.to, message.type, prepared.subject);
    const sent = await transport.send(prepared);
    const acknowledged=await transaction(db, async tx => {
      const completed = await tx.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, lastFailureCode: null } });
      if (completed.count) await tx.auditEvent.create({ data: { actorType: "SYSTEM", action: message.type === "AUTH_EMAIL" ? "AUTH_EMAIL_SENT" : "LEADER_INVITATION_EMAIL_SENT", entityType: "OutboxMessage", entityId: message.id, correlationId: randomUUID(), metadata: {} } });
      if (completed.count) await tx.emailDelivery.update({ where: { outboxMessageId: message.id }, data: { provider: sent.provider, providerMessageId: sent.messageId, status: "SENT", attempts: message.attempts + 1, sentAt: new Date(), lastFailureCode: null } });
      if (completed.count) await recordEmailSent(tx, message.id, sent);
      return completed.count===1;
    });
    return acknowledged?"SENT":"UNCERTAIN";
  } catch {
    await finishDeliveryFailure(db,message.id,owner,message.attempts+1,8);
    return "FAILED";
  }
}
