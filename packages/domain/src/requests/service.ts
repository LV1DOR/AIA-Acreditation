import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { resolveActor, requireAdmin, requireCompany } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { recordNotification } from "../notifications/record.ts";
import { calendarDate } from "../shared/calendar-date.ts";

const requestPayload = z.discriminatedUnion("type", [
  z.object({ type:z.literal("EXTRA_PERSONNEL"), additionalSlots:z.number().int().min(1).max(100) }).strict(),
  z.object({ type:z.literal("ADD_AFTER_DEADLINE"), count:z.number().int().min(1).max(20) }).strict(),
  z.object({ type:z.literal("REMOVE_AFTER_DEADLINE") }).strict(),
  z.object({ type:z.literal("REPLACE_PERSON"), replacementName:z.string().trim().min(2).max(200) }).strict(),
  z.object({ type:z.literal("EDIT_PERSON"), scope:z.enum(["IDENTITY","CONTACT","ROLE","OTHER"]) }).strict(),
  z.object({ type:z.literal("CHANGE_WORK_DAYS"), workDays:z.array(calendarDate).min(1).max(31) }).strict(),
  z.object({ type:z.literal("REPLACE_PHOTO") }).strict(),
  z.object({ type:z.literal("VEHICLE_PASS_CHANGE"), required:z.boolean(), requestedQuantity:z.number().int().min(0).max(100), justification:z.string().trim().max(2000).nullable() }).strict(),
  z.object({ type:z.literal("ZONE_CHANGE"), zoneIds:z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ type:z.literal("OTHER") }).strict(),
]);

const createInput = z.object({ registrationId:z.uuid(), targetParticipantId:z.uuid().optional(), priority:z.enum(["NORMAL","URGENT"]).default("NORMAL"), reason:z.string().trim().min(5).max(2000), payload:requestPayload }).strict();
const decisionInput = z.object({ requestId:z.uuid(), expectedVersion:z.number().int().positive(), decision:z.enum(["APPROVE","REJECT"]), comment:z.string().trim().max(2000).optional() }).strict();

const participantTypes = new Set(["REMOVE_AFTER_DEADLINE","REPLACE_PERSON","EDIT_PERSON","CHANGE_WORK_DAYS","REPLACE_PHOTO"]);

export async function createCompanyRequest(db: PrismaClient, context: ActorContext, raw: z.input<typeof createInput>) {
  const input = createInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    if (actor.role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    const registration = await tx.companyEventRegistration.findUnique({ where:{ id:input.registrationId }, include:{ event:true } });
    if (!registration) throw new DomainError("INVALID_INPUT");
    await requireCompany(tx, actor, registration.companyId);
    if (participantTypes.has(input.payload.type) !== Boolean(input.targetParticipantId)) throw new DomainError("INVALID_INPUT");
    if (input.targetParticipantId) {
      const target = await tx.eventParticipant.findFirst({ where:{ id:input.targetParticipantId, registrationId:registration.id, status:{ notIn:["REMOVED","REPLACED"] } }, select:{ id:true } });
      if (!target) throw new DomainError("INVALID_INPUT");
    }
    const duplicate = await tx.companyRequest.count({ where:{ registrationId:registration.id, targetParticipantId:input.targetParticipantId ?? null, type:input.payload.type, status:"PENDING" } });
    if (duplicate) throw new DomainError("STALE_WRITE");
    const request = await tx.companyRequest.create({ data:{ registrationId:registration.id, targetParticipantId:input.targetParticipantId, createdByUserId:actor.userId, type:input.payload.type, priority:input.priority, reason:input.reason, payload:input.payload } });
    await appendAudit(tx, actor, { action:"REQUEST_SUBMITTED", entityType:"CompanyRequest", entityId:request.id, eventId:registration.eventId, companyId:registration.companyId, metadata:{ requestType:request.type, priority:request.priority } });
    const admins = await tx.user.findMany({ where:{ role:"ADMIN", disabledAt:null }, select:{ id:true } });
    for (const admin of admins) await recordNotification(tx, { recipientUserId:admin.id, eventId:registration.eventId, registrationId:registration.id, type:"REQUEST_SUBMITTED", deduplicationKey:`request:${request.id}:submitted:${admin.id}`, parameters:{ requestId:request.id, requestType:request.type } });
    await enqueueInvalidation(tx, `request:${request.id}:submitted`, { entityId:request.id, eventId:registration.eventId, version:request.version });
    return request;
  });
}

export async function cancelCompanyRequest(db: PrismaClient, context: ActorContext, requestId: string, expectedVersion: number) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const request = await tx.companyRequest.findUnique({ where:{ id:requestId }, include:{ registration:true } });
    if (!request) throw new DomainError("INVALID_INPUT");
    await requireCompany(tx, actor, request.registration.companyId);
    if (actor.role !== "COMPANY_LEADER" || request.createdByUserId !== actor.userId || request.status !== "PENDING" || request.version !== expectedVersion) throw new DomainError("STALE_WRITE");
    const updated = await tx.companyRequest.update({ where:{ id:request.id }, data:{ status:"CANCELLED", version:{ increment:1 } } });
    await appendAudit(tx, actor, { action:"REQUEST_CANCELLED", entityType:"CompanyRequest", entityId:request.id, eventId:request.registration.eventId, companyId:request.registration.companyId, metadata:{ requestType:request.type, priority:request.priority } });
    await enqueueInvalidation(tx, `request:${request.id}:cancelled`, { entityId:request.id, eventId:request.registration.eventId, version:updated.version });
    return updated;
  });
}

export async function decideCompanyRequest(db: PrismaClient, context: ActorContext, raw: z.input<typeof decisionInput>) {
  const input = decisionInput.parse(raw);
  if (input.decision === "REJECT" && !input.comment?.trim()) throw new DomainError("INVALID_INPUT");
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const request = await tx.companyRequest.findUnique({ where:{ id:input.requestId }, include:{ registration:{ include:{ event:true } } } });
    if (!request || request.status !== "PENDING" || request.version !== input.expectedVersion) throw new DomainError("STALE_WRITE");
    const payload = requestPayload.parse(request.payload);
    if (input.decision === "APPROVE") await applyApprovedRequest(tx, request.id, request.registration, request.targetParticipantId, payload);
    const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await tx.companyRequest.update({ where:{ id:request.id }, data:{ status, resolutionComment:input.comment?.trim() || null, reviewedByUserId:actor.userId, reviewedAt:new Date(), version:{ increment:1 } } });
    await appendAudit(tx, actor, { action:input.decision === "APPROVE" ? "REQUEST_APPROVED" : "REQUEST_REJECTED", entityType:"CompanyRequest", entityId:request.id, eventId:request.registration.eventId, companyId:request.registration.companyId, metadata:{ requestType:request.type, priority:request.priority } });
    await recordNotification(tx, { recipientUserId:request.createdByUserId, eventId:request.registration.eventId, registrationId:request.registration.id, type:input.decision === "APPROVE" ? "REQUEST_APPROVED" : "REQUEST_REJECTED", deduplicationKey:`request:${request.id}:${status.toLowerCase()}`, parameters:{ requestId:request.id, requestType:request.type } });
    await enqueueInvalidation(tx, `request:${request.id}:${status.toLowerCase()}`, { entityId:request.id, eventId:request.registration.eventId, version:updated.version });
    return updated;
  });
}

async function reopenForFinalReview(tx: Parameters<Parameters<typeof transaction>[1]>[0], registrationId: string) {
  await tx.companyEventRegistration.updateMany({ where:{ id:registrationId, status:{ not:"RETURNED_FOR_CORRECTION" } }, data:{ status:"RETURNED_FOR_CORRECTION", version:{ increment:1 } } });
}

async function applyApprovedRequest(tx: Parameters<Parameters<typeof transaction>[1]>[0], requestId: string, registration: { id:string; eventId:string; personnelLimit:number; event:{ startDate:Date; endDate:Date } }, targetParticipantId: string | null, payload: z.output<typeof requestPayload>) {
  if (payload.type === "EXTRA_PERSONNEL") { await tx.companyEventRegistration.update({ where:{ id:registration.id }, data:{ personnelLimit:{ increment:payload.additionalSlots }, version:{ increment:1 } } }); return; }
  if (payload.type === "ADD_AFTER_DEADLINE") { const active=await tx.eventParticipant.count({ where:{ registrationId:registration.id, status:{ notIn:["REMOVED","REPLACED"] } } }); if(active + payload.count > registration.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED"); await tx.eventParticipant.createMany({ data:Array.from({ length:payload.count }, () => ({ registrationId:registration.id, eventId:registration.eventId })) }); return; }
  if (payload.type === "REMOVE_AFTER_DEADLINE" && targetParticipantId) { await tx.eventParticipant.update({ where:{ id:targetParticipantId }, data:{ status:"REMOVED", version:{ increment:1 } } }); await tx.employeeInvitationToken.updateMany({ where:{ participantId:targetParticipantId, usedAt:null, revokedAt:null }, data:{ revokedAt:new Date() } }); await reopenForFinalReview(tx, registration.id); return; }
  if (payload.type === "REPLACE_PERSON" && targetParticipantId) {
    await tx.eventParticipant.update({ where:{ id:targetParticipantId }, data:{ status:"REPLACED", version:{ increment:1 } } });
    await tx.employeeInvitationToken.updateMany({ where:{ participantId:targetParticipantId, usedAt:null, revokedAt:null }, data:{ revokedAt:new Date() } });
    await tx.eventParticipant.create({ data:{ registrationId:registration.id, eventId:registration.eventId, fullName:payload.replacementName, status:"DRAFT", replacementRequestId:requestId } });
    await reopenForFinalReview(tx, registration.id);
    return;
  }
  if (payload.type === "CHANGE_WORK_DAYS" && targetParticipantId) { const days=[...new Set(payload.workDays)].map(value => new Date(`${value}T00:00:00.000Z`)); if(days.some(day => day < registration.event.startDate || day > registration.event.endDate)) throw new DomainError("INVALID_INPUT"); await tx.participantWorkDay.deleteMany({ where:{ participantId:targetParticipantId } }); await tx.participantWorkDay.createMany({ data:days.map(workDate => ({ participantId:targetParticipantId, workDate })) }); await tx.eventParticipant.update({ where:{ id:targetParticipantId }, data:{ version:{ increment:1 } } }); return; }
  if (payload.type === "VEHICLE_PASS_CHANGE") { if(payload.required && (!payload.requestedQuantity || !payload.justification)) throw new DomainError("INVALID_INPUT"); await tx.vehiclePassRequest.upsert({ where:{ registrationId:registration.id }, create:{ registrationId:registration.id, required:payload.required, requestedQuantity:payload.required ? payload.requestedQuantity : 0, justification:payload.required ? payload.justification : null }, update:{ required:payload.required, requestedQuantity:payload.required ? payload.requestedQuantity : 0, justification:payload.required ? payload.justification : null, approvedQuantity:null, decidedAt:null, decidedByUserId:null, version:{ increment:1 } } }); await reopenForFinalReview(tx, registration.id); return; }
  if (payload.type === "ZONE_CHANGE") {
    const valid = await tx.eventZone.findMany({ where:{ eventId:registration.eventId, zoneId:{ in:payload.zoneIds }, deactivatedAt:null }, select:{ zoneId:true } });
    if (valid.length !== new Set(payload.zoneIds).size) throw new DomainError("INVALID_INPUT");
    await tx.companyZoneRequest.deleteMany({ where:{ registrationId:registration.id } });
    await tx.companyZoneRequest.createMany({ data:payload.zoneIds.map(zoneId => ({ registrationId:registration.id, eventId:registration.eventId, zoneId })) });
    await reopenForFinalReview(tx, registration.id);
    return;
  }
  if (payload.type === "OTHER") return;
  throw new DomainError("INVALID_INPUT");
}

export async function companyRequests(db: PrismaClient, context: ActorContext, registrationId: string) {
  const actor = await resolveActor(db, context);
  const registration = await db.companyEventRegistration.findUnique({ where:{ id:registrationId }, select:{ companyId:true } });
  if (!registration) throw new DomainError("INVALID_INPUT");
  await requireCompany(db, actor, registration.companyId);
  return db.companyRequest.findMany({ where:{ registrationId }, orderBy:[{ createdAt:"desc" },{ id:"desc" }], include:{ targetParticipant:{ select:{ id:true, fullName:true } } } });
}

export async function pendingAdminRequests(db: PrismaClient, context: ActorContext) {
  const actor = await resolveActor(db, context); requireAdmin(actor);
  return db.companyRequest.findMany({ where:{ status:"PENDING" }, orderBy:[{ priority:"desc" },{ createdAt:"asc" }], include:{ registration:{ select:{ company:{ select:{ name:true } }, event:{ select:{ name:true } } } }, targetParticipant:{ select:{ fullName:true } } } });
}
