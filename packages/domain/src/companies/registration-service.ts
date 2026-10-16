import { z } from "zod";
import { ReviewReasonCategory, type PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { DomainError } from "../shared/errors.ts";
import { requireAdmin, requireCompany, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { recordNotification } from "../notifications/record.ts";
import { assertCanEdit, onboardingOpen } from "../submissions/edit-policy.ts";
import { registrationCapabilities } from "../submissions/capabilities.ts";
import { vehicleRequestSchema } from "../vehicle-passes/policy.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";

const createInput = z.object({ eventId: z.uuid(), companyId: z.uuid(), primaryLeaderMembershipId: z.uuid().optional(), personnelLimit: z.number().int().min(1).max(10000).default(10) }).strict();
export async function createRegistration(db: PrismaClient, context: ActorContext, raw: z.input<typeof createInput>) {
  const data = createInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const company = await tx.company.findUnique({ where: { id: data.companyId } });
    if (!company || company.deactivatedAt) throw new DomainError("INVALID_INPUT");
    const event = await tx.event.findUnique({ where: { id: data.eventId } });
    if (!event || event.status === "ARCHIVED") throw new DomainError("INVALID_INPUT");
    if (data.primaryLeaderMembershipId) {
      const member = await tx.companyLeaderMembership.findFirst({ where: { id: data.primaryLeaderMembershipId, companyId: data.companyId, revokedAt: null, user: { disabledAt: null, role: "COMPANY_LEADER" } } });
      if (!member) throw new DomainError("INVALID_INPUT");
    }
    const registration = await tx.companyEventRegistration.create({ data });
    await appendAudit(tx, actor, { action: "REGISTRATION_CREATED", entityType: "CompanyEventRegistration", entityId: registration.id, eventId: data.eventId, companyId: data.companyId });
    await enqueueInvalidation(tx, "registration:" + registration.id + ":1", { entityId: registration.id, eventId: data.eventId, version: 1 });
    return registration;
  });
}
const limitInput = z.object({ registrationId: z.uuid(), expectedVersion: z.number().int().positive(), personnelLimit: z.number().int().min(1).max(10000) }).strict();
export async function updatePersonnelLimit(db: PrismaClient, context: ActorContext, raw: z.input<typeof limitInput>) {
  const input = limitInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: input.registrationId } });
    if (!registration) throw new DomainError("INVALID_INPUT");
    const activeCount = await tx.eventParticipant.count({ where: { registrationId: registration.id, status: { notIn: ["REMOVED", "REPLACED"] } } });
    if (input.personnelLimit < activeCount) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    const changed = await tx.companyEventRegistration.updateMany({ where: { id: input.registrationId, version: input.expectedVersion }, data: { personnelLimit: input.personnelLimit, version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    if (registration.personnelLimit !== input.personnelLimit) await invalidateEffectiveApproval(tx, actor, registration.id);
    const version = (await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: registration.id }, select: { version: true } })).version;
    await appendAudit(tx, actor, { action: "REGISTRATION_LIMIT_UPDATED", entityType: "CompanyEventRegistration", entityId: registration.id, companyId: registration.companyId, eventId: registration.eventId, metadata: { version } });
    await enqueueInvalidation(tx, `registration:${registration.id}:${version}`, { entityId: registration.id, eventId: registration.eventId, version });
    return { id: registration.id, version };
  });
}
const configureInput = z.object({
  registrationId: z.uuid(), expectedVersion: z.number().int().positive(),
  zoneIds: z.array(z.uuid()).max(1000).refine(ids => new Set(ids).size === ids.length),
  vehicle: vehicleRequestSchema,
  overrideReason: z.enum(ReviewReasonCategory).optional(),
}).strict();
export async function configureRegistration(db: PrismaClient, context: ActorContext, raw: z.input<typeof configureInput>) {
  const input = configureInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: input.registrationId }, include: { event: true, company:true, primaryLeader: true, zones:true, vehiclePass:true } });
    if (!registration) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, registration.companyId);
    // Snapshot-aware admin changes are added with Phase 5; never mutate approved content in place.
    if (actor.role === "ADMIN" && !["DRAFT", "RETURNED_FOR_CORRECTION"].includes(registration.status)) throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    if(registration.company.internalOrganisation) throw new DomainError("FORBIDDEN");
    const now = new Date();
    if(actor.role === "ADMIN") assertCanEdit(registration, actor.role, now, input.overrideReason);
    else {
      if(registration.status==="DRAFT" && !onboardingOpen(registration,now)) throw new DomainError("DEADLINE_CLOSED");
      const caps=await registrationCapabilities(tx,registration.id,actor.role);
      const zoneChange=JSON.stringify([...input.zoneIds].sort())!==JSON.stringify(registration.zones.map(x=>x.zoneId).sort());
      const v=registration.vehiclePass;
      const vehicleChange=!v || input.vehicle.required!==v.required || input.vehicle.requestedQuantity!==v.requestedQuantity || (input.vehicle.justification??null)!==v.justification;
      if((zoneChange && !caps.zones) || (vehicleChange && !caps.vehicle) || (!caps.zones && !caps.vehicle)) throw new DomainError("EDIT_LOCKED");
    }
    const matches = await tx.eventZone.count({ where: { eventId: registration.eventId, zoneId: { in: input.zoneIds }, deactivatedAt: null, zone: { deactivatedAt: null } } });
    if (matches !== input.zoneIds.length) throw new DomainError("INVALID_INPUT");
    const updated = await tx.companyEventRegistration.updateMany({ where: { id: registration.id, version: input.expectedVersion }, data: { version: { increment: 1 } } });
    if (updated.count !== 1) throw new DomainError("STALE_WRITE");
    await tx.companyZoneRequest.deleteMany({ where: { registrationId: registration.id } });
    await tx.companyZoneRequest.createMany({ data: input.zoneIds.map(zoneId => ({ registrationId: registration.id, eventId: registration.eventId, zoneId })) });
    await tx.vehiclePassRequest.upsert({ where: { registrationId: registration.id },
      create: { registrationId: registration.id, ...input.vehicle, requestedAt: now },
      update: { ...input.vehicle, requestedAt: now, approvedQuantity: null, decisionComment: null, decidedByUserId: null, decidedAt: null, version: { increment: 1 } }
    });
    const version = input.expectedVersion + 1;
    const override = actor.role === "ADMIN" && !onboardingOpen(registration, now);
    await appendAudit(tx, actor, { action: "REGISTRATION_CONFIGURED", entityType: "CompanyEventRegistration", entityId: registration.id, companyId: registration.companyId, eventId: registration.eventId, metadata: { version, override, ...(override ? { reasonCategory: input.overrideReason } : {}) } });
    const key = "registration:" + registration.id + ":" + version;
    await enqueueInvalidation(tx, key, { entityId: registration.id, eventId: registration.eventId, version });
    if (actor.role === "ADMIN" && registration.primaryLeader && !registration.primaryLeader.revokedAt) {
      await recordNotification(tx, { recipientUserId: registration.primaryLeader.userId, eventId: registration.eventId, registrationId: registration.id, type: "REGISTRATION_UPDATED", deduplicationKey: key, parameters: { updateKind: "REGISTRATION_CONFIGURATION" } });
    }
    return { id: registration.id, version };
  });
}
