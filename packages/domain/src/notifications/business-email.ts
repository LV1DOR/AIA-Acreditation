import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { businessEmailTemplate, renderBusinessEmail, type EmailTransport } from "@aia/email";
import type { Tx } from "../shared/transaction.ts";
import { transaction } from "../shared/transaction.ts";

const payloadSchema = z.object({
  recipientUserId: z.uuid(), template: businessEmailTemplate,
  companyName: z.string().trim().min(1).max(200), eventName: z.string().trim().min(1).max(200),
  path: z.string().startsWith("/").max(500), deadline: z.string().trim().max(100).optional(),
}).strict();
export type BusinessEmailPayload = z.infer<typeof payloadSchema>;

export async function queueBusinessEmail(tx: Tx, deduplicationKey: string, raw: BusinessEmailPayload) {
  const payload = payloadSchema.parse(raw), id = randomUUID();
  const created = await tx.outboxMessage.createMany({ data: [{ id, type: "BUSINESS_EMAIL", deduplicationKey, payload }], skipDuplicates: true });
  if (created.count) await tx.emailDelivery.create({ data: { outboxMessageId: id } });
  return { queued: created.count === 1 };
}

export async function deliverNextBusinessEmail(db: PrismaClient, transport: EmailTransport, appOrigin: string, resolveEmail: (clerkUserId: string) => Promise<string>) {
  const owner = randomUUID(), now = new Date();
  const message = await transaction(db, async tx => {
    const where = { type: "BUSINESS_EMAIL", processedAt: null, attempts: { lt: 8 }, availableAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] };
    const row = await tx.outboxMessage.findFirst({ where, orderBy: [{ availableAt: "asc" }, { id: "asc" }] });
    if (!row) return null;
    const claimed = await tx.outboxMessage.updateMany({ where: { ...where, id: row.id }, data: { leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + 60000), attempts: { increment: 1 } } });
    return claimed.count ? row : null;
  });
  if (!message) return "IDLE";
  try {
    const payload = payloadSchema.parse(message.payload);
    const user = await db.user.findUniqueOrThrow({ where: { id: payload.recipientUserId }, select: { clerkUserId: true, disabledAt: true } });
    if (user.disabledAt) throw new Error("RECIPIENT_UNAVAILABLE");
    const recipient = (await resolveEmail(user.clerkUserId)).trim().toLowerCase();
    const appUrl = new URL(payload.path, new URL(appOrigin).origin).toString();
    const rendered = await renderBusinessEmail(payload.template, { companyName: payload.companyName, eventName: payload.eventName, appUrl, deadline: payload.deadline });
    const sent = await transport.send({ deliveryId: message.id, to: recipient, ...rendered });
    await transaction(db, async tx => {
      const completed = await tx.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, lastFailureCode: null } });
      if (completed.count) {
        await tx.emailDelivery.update({ where: { outboxMessageId: message.id }, data: { recipientHash: createHash("sha256").update(recipient).digest("hex"), provider: sent.provider, providerMessageId: sent.messageId, status: "SENT", attempts: message.attempts + 1, sentAt: new Date(), lastFailureCode: null } });
        await tx.auditEvent.create({ data: { actorType: "SYSTEM", action: "BUSINESS_EMAIL_SENT", entityType: "OutboxMessage", entityId: message.id, correlationId: randomUUID(), metadata: { template: payload.template } } });
      }
    });
    return "SENT";
  } catch {
    const attempts = message.attempts + 1, final = attempts >= 8;
    await transaction(db, async tx => {
      await tx.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { leaseOwner: null, leaseExpiresAt: null, availableAt: new Date(Date.now() + Math.min(300, 2 ** attempts) * 1000), lastFailureCode: final ? "EMAIL_DELIVERY_FAILED_FINAL" : "EMAIL_DELIVERY_FAILED", ...(final ? { payload: {} } : {}) } });
      await tx.emailDelivery.update({ where: { outboxMessageId: message.id }, data: { status: final ? "FAILED" : "RETRYING", attempts, lastFailureCode: final ? "EMAIL_DELIVERY_FAILED_FINAL" : "EMAIL_DELIVERY_FAILED" } });
    });
    return "FAILED";
  }
}

export async function enqueueDueDeadlineReminders(db: PrismaClient, now = new Date()) {
  const horizon = new Date(now.getTime() + 8 * 86400000);
  const registrations = await db.companyEventRegistration.findMany({ where: { status: { in: ["DRAFT", "RETURNED_FOR_CORRECTION"] }, primaryLeaderMembershipId: { not: null }, event: { onboardingClosesAt: { gt: now, lte: horizon } } }, select: { id: true, eventId: true, company: { select: { name: true } }, event: { select: { name: true, onboardingClosesAt: true, timezone: true } }, primaryLeader: { select: { userId: true, revokedAt: true } } } });
  let queued = 0;
  for (const registration of registrations) {
    if (!registration.primaryLeader || registration.primaryLeader.revokedAt) continue;
    const days = Math.ceil((registration.event.onboardingClosesAt.getTime() - now.getTime()) / 86400000);
    if (![7, 3, 1].includes(days)) continue;
    const result = await transaction(db, tx => queueBusinessEmail(tx, `deadline-reminder:${registration.id}:${days}`, { recipientUserId: registration.primaryLeader!.userId, template: "DEADLINE_REMINDER", companyName: registration.company.name, eventName: registration.event.name, path: `/portal`, deadline: new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeStyle: "short", timeZone: registration.event.timezone }).format(registration.event.onboardingClosesAt) }));
    if (result.queued) queued += 1;
  }
  return queued;
}
