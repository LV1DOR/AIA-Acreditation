import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction, type Tx } from "../shared/transaction.ts";
import { resolveActor, requireAdmin } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
import { recordNotifications } from "../notifications/record.ts";

const input = z.object({ id: z.uuid(), eventId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();

async function assertNotErasing(tx: Tx, registrationId: string) {
  if (await tx.privacyErasureJob.count({ where: { registrationId, status: { not: "CANCELLED" } } })) throw new DomainError("EDIT_LOCKED");
}

async function notifyLeaders(tx: Tx, companyId: string, registrationId: string, eventId: string, key: string, updateKind: string) {
  const leaders = await tx.companyLeaderMembership.findMany({ where: { companyId, revokedAt: null, user: { disabledAt: null, role: "COMPANY_LEADER" } }, select: { userId: true } });
  await recordNotifications(tx, leaders.map(leader => ({ recipientUserId: leader.userId, registrationId, eventId,
    type: "REGISTRATION_UPDATED" as const, deduplicationKey: `${key}:${leader.userId}`, parameters: { updateKind } })));
}

// Administrative withdrawal is event-scoped. It never deletes personal data or
// changes a company-wide membership, another event, or an immutable snapshot.
export async function removeCompanyFromEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const p = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const r = await tx.companyEventRegistration.findUnique({ where: { id: p.id } });
    if (!r || r.eventId !== p.eventId) throw new DomainError("NOT_FOUND");
    if (r.withdrawnAt) return { id: r.id, alreadyRemoved: true };
    if (r.erasedAt) throw new DomainError("EDIT_LOCKED");
    if (r.version !== p.expectedVersion) throw new DomainError("STALE_WRITE");
    await assertNotErasing(tx, r.id);
    const now = new Date();
    const changed = await tx.companyEventRegistration.updateMany({ where: { id: r.id, eventId: p.eventId, version: p.expectedVersion, withdrawnAt: null },
      data: { withdrawnAt: now, status: "REJECTED", version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    // Append an invalidation, preserving the original approval and snapshot.
    if (["APPROVED", "AIA_REVIEW"].includes(r.status)) {
      const latest = await tx.companySubmission.findFirst({ where: { registrationId: r.id }, orderBy: { version: "desc" }, select: { id: true } });
      if (latest) await tx.companySubmissionReview.create({ data: { submissionId: latest.id, outcome: "APPROVAL_INVALIDATED", reviewedByUserId: actor.userId } });
    }
    await tx.eventParticipant.updateMany({ where: { registrationId: r.id, status: { notIn: ["REMOVED", "REPLACED"] } }, data: { status: "REMOVED", version: { increment: 1 } } });
    await tx.employeeInvitationToken.updateMany({ where: { participant: { registrationId: r.id }, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.leaderInvitation.updateMany({ where: { registrationId: r.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await tx.companyRequest.updateMany({ where: { registrationId: r.id, status: "PENDING" }, data: { status: "CANCELLED", version: { increment: 1 } } });
    const version = r.version + 1, key = `registration:${r.id}:removed:${version}`;
    await appendAudit(tx, actor, { action: "REGISTRATION_REMOVED", entityType: "CompanyEventRegistration", entityId: r.id, eventId: r.eventId, companyId: r.companyId, metadata: { version } });
    await enqueueInvalidation(tx, key, { entityId: r.id, eventId: r.eventId, version });
    await notifyLeaders(tx, r.companyId, r.id, r.eventId, key, "REGISTRATION_REMOVED");
    return { id: r.id, alreadyRemoved: false };
  });
}

export async function removePersonFromEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const p = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const person = await tx.eventParticipant.findUnique({ where: { id: p.id }, include: { registration: true } });
    if (!person || person.eventId !== p.eventId) throw new DomainError("NOT_FOUND");
    if (["REMOVED", "REPLACED"].includes(person.status)) return { id: person.id, alreadyRemoved: true };
    if (person.erasedAt || person.registration.erasedAt || person.registration.withdrawnAt) throw new DomainError("EDIT_LOCKED");
    if (person.version !== p.expectedVersion) throw new DomainError("STALE_WRITE");
    await assertNotErasing(tx, person.registrationId);
    const changed = await tx.eventParticipant.updateMany({ where: { id: person.id, eventId: p.eventId, version: p.expectedVersion, status: person.status }, data: { status: "REMOVED", version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    if (person.registration.status === "AIA_REVIEW") await invalidateEffectiveApproval(tx, actor, person.registrationId);
    // Bump registration version so an in-flight review cannot approve stale scope.
    // Other approved people keep their effective access; this person's status and
    // version independently remove them from the approved snapshot's active scope.
    await tx.companyEventRegistration.update({ where: { id: person.registrationId }, data: { version: { increment: 1 } } });
    await tx.employeeInvitationToken.updateMany({ where: { participantId: person.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.companyRequest.updateMany({ where: { targetParticipantId: person.id, status: "PENDING" }, data: { status: "CANCELLED", version: { increment: 1 } } });
    const version = person.version + 1, key = `participant:${person.id}:removed:${version}`;
    await appendAudit(tx, actor, { action: "PARTICIPANT_REMOVED", entityType: "EventParticipant", entityId: person.id, eventId: person.eventId, companyId: person.registration.companyId, metadata: { version } });
    await enqueueInvalidation(tx, key, { entityId: person.id, eventId: person.eventId, version });
    await notifyLeaders(tx, person.registration.companyId, person.registrationId, person.eventId, key, "PARTICIPANT_REMOVED");
    return { id: person.id, alreadyRemoved: false };
  });
}
