import { claimDelivery, finishDeliveryFailure, reconcileExpiredDeliveryLeases, businessDeliveryContext } from "./recovery.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { businessEmailTemplate, renderBusinessEmail, type EmailTransport } from "@aia/email";
import type { Tx } from "../shared/transaction.ts";
import { transaction } from "../shared/transaction.ts";

const payloadSchema = z.object({
  recipientUserId: z.uuid(), registrationId:z.uuid().optional(), template: businessEmailTemplate,
  companyName: z.string().trim().min(1).max(200), eventName: z.string().trim().min(1).max(200),
  path: z.string().startsWith("/").max(500), deadline: z.string().trim().max(100).optional(),
}).strict();
export type BusinessEmailPayload = z.infer<typeof payloadSchema>;

export async function queueBusinessEmail(tx: Tx, deduplicationKey: string, raw: BusinessEmailPayload) {
  const payload = payloadSchema.parse(raw), id = randomUUID();
  const created = await tx.outboxMessage.createMany({ data: [{ id, type: "BUSINESS_EMAIL", deduplicationKey, payload,...await businessDeliveryContext(tx,payload) }], skipDuplicates: true });
  if (created.count) await tx.emailDelivery.create({ data: { outboxMessageId: id } });
  return { queued: created.count === 1 };
}
export async function queueBusinessEmails(tx:Tx,raw:{deduplicationKey:string;payload:BusinessEmailPayload}[]) {
  const contexts=new Map<string,Promise<Awaited<ReturnType<typeof businessDeliveryContext>>>>();
  const rows=await Promise.all(raw.map(async row=>{const p=payloadSchema.parse(row.payload),key=JSON.stringify([p.registrationId,p.companyName,p.eventName]);let context=contexts.get(key);if(!context){context=businessDeliveryContext(tx,p);contexts.set(key,context);}return {id:randomUUID(),type:"BUSINESS_EMAIL",deduplicationKey:row.deduplicationKey,payload:p,...await context,...((await context).registrationId?{recoveryPayload:{recipientUserId:p.recipientUserId,registrationId:(await context).registrationId!}}:{})};}));
  for(let offset=0;offset<rows.length;offset+=1000) {
    const created=await tx.outboxMessage.createManyAndReturn({data:rows.slice(offset,offset+1000),skipDuplicates:true,select:{id:true}});
    if(created.length) await tx.emailDelivery.createMany({data:created.map(row=>({outboxMessageId:row.id}))});
  }
}

// Revocation notices inform a former member; they never grant portal access.
// All other messages still require current membership at delivery time.
export async function businessEmailMembershipAllowed(db: Pick<PrismaClient, "companyLeaderMembership">, template: string, companyId: string, userId: string) {
  if (await db.companyLeaderMembership.count({ where: { companyId, userId, revokedAt: null } })) return true;
  return template === "ACCESS_REMOVED" && Boolean(await db.companyLeaderMembership.count({ where: { companyId, userId, revokedAt: { not: null } } }));
}

export async function deliverNextBusinessEmail(db: PrismaClient, transport: EmailTransport, appOrigin: string, resolveEmail: (clerkUserId: string) => Promise<string>) {
  const owner = randomUUID(), now = new Date();
  await reconcileExpiredDeliveryLeases(db,now);
  const message=await transaction(db,tx=>claimDelivery(tx,["BUSINESS_EMAIL"],8,owner,now));
  if (!message) return "IDLE";
  try {
    const payload = payloadSchema.parse(message.payload);
    const user = await db.user.findUniqueOrThrow({ where: { id: payload.recipientUserId }, select: { clerkUserId: true, disabledAt: true,role:true } });
    if (user.disabledAt) throw new Error("RECIPIENT_UNAVAILABLE");
    let template=payload.template;
    if(message.registrationId){const r=await db.companyEventRegistration.findUnique({where:{id:message.registrationId},include:{company:true}});if(!r||r.erasedAt||(r.withdrawnAt&&template!=="REGISTRATION_REMOVED")||r.company.deactivatedAt||(user.role!=="ADMIN"&&!await businessEmailMembershipAllowed(db,template,r.companyId,payload.recipientUserId))){await finishDeliveryFailure(db,message.id,owner,message.attempts+1,8,"RECIPIENT_SCOPE_CLOSED",true);return "FAILED";}const expectedStates:Record<string,string>={SUBMISSION_APPROVED:"APPROVED",SUBMISSION_RETURNED:"RETURNED_FOR_CORRECTION",SUBMISSION_RECEIVED:"AIA_REVIEW",SUBMISSION_REJECTED:"REJECTED"};const expected=expectedStates[template];if(expected&&r.status!==expected)template="STATUS_UPDATE";}
    const recipient = (await resolveEmail(user.clerkUserId)).trim().toLowerCase();
    const appUrl = new URL(payload.path, new URL(appOrigin).origin).toString();
    const rendered = await renderBusinessEmail(template, { companyName: payload.companyName, eventName: payload.eventName, appUrl, deadline: payload.deadline });
    const sent = await transport.send({ deliveryId: message.id, to: recipient, ...rendered });
    const acknowledged=await transaction(db, async tx => {
      const completed = await tx.outboxMessage.updateMany({ where: { id: message.id, leaseOwner: owner }, data: { processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, payload: {}, recoveryPayload:{},lastFailureCode: null } });
      if (completed.count) {
        await tx.emailDelivery.update({ where: { outboxMessageId: message.id }, data: { recipientHash: createHash("sha256").update(recipient).digest("hex"), provider: sent.provider, providerMessageId: sent.messageId, status: "SENT", attempts: message.attempts + 1, sentAt: new Date(), lastFailureCode: null } });
        await tx.auditEvent.create({ data: { actorType: "SYSTEM", action: "BUSINESS_EMAIL_SENT", entityType: "OutboxMessage", entityId: message.id, correlationId: randomUUID(), metadata: { template: payload.template } } });
      }
      return completed.count===1;
    });
    return acknowledged?"SENT":"UNCERTAIN";
  } catch {
    await finishDeliveryFailure(db,message.id,owner,message.attempts+1,8);
    return "FAILED";
  }
}

export async function enqueueDueDeadlineReminders(db: PrismaClient, now = new Date()) {
  const horizon = new Date(now.getTime() + 8 * 86400000);
  const registrations = await db.companyEventRegistration.findMany({ where: { withdrawnAt: null, status: { in: ["DRAFT", "RETURNED_FOR_CORRECTION"] }, primaryLeaderMembershipId: { not: null }, event: { onboardingClosesAt: { gt: now, lte: horizon } } }, select: { id: true, eventId: true, company: { select: { name: true } }, event: { select: { name: true, onboardingClosesAt: true, timezone: true } }, primaryLeader: { select: { userId: true, revokedAt: true } } } });
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
