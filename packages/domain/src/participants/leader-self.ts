import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { resolveActor, requireCompany } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { assertRegistrationNotErasing } from "../privacy/notices.ts";
import { registrationCapabilities } from "../submissions/capabilities.ts";

// Server-assigned operational reference. The existing per-registration unique
// index prevents duplicate self records; existing privacy erasure clears it.
const reference = (userId: string) => "leader-self:" + userId;
const active = ["DRAFT", "AWAITING_EMPLOYEE", "AWAITING_LEADER_REVIEW", "LEADER_APPROVED", "DUPLICATE_REVIEW_REQUIRED"] as const;
const profileSelect = {
  id: true, status: true, erasedAt: true, fullName: true, dateOfBirth: true,
  documentNumberFingerprint: true, documentExpiryDate: true, documentType: true,
  mobileE164: true, nationalityCode: true, jobRoleId: true, photoObjectKey: true,
  privacyAcknowledgedAt: true, workDays: { select: { workDate: true } },
} as const;

export function leaderSelfProfileComplete(p: {
  status: string; erasedAt: Date | null; fullName: string | null; dateOfBirth: Date | null;
  documentNumberFingerprint: string | null; documentExpiryDate: Date | null; documentType: string | null;
  mobileE164: string | null; nationalityCode: string | null; jobRoleId: string | null;
  photoObjectKey: string | null; privacyAcknowledgedAt: Date | null; workDays: readonly unknown[];
} | null | undefined) {
  return Boolean(p && !p.erasedAt && !["REMOVED", "REPLACED"].includes(p.status) && p.fullName &&
    p.dateOfBirth && p.documentNumberFingerprint && p.documentExpiryDate && p.documentType &&
    p.mobileE164 && p.nationalityCode && p.jobRoleId && p.photoObjectKey &&
    p.privacyAcknowledgedAt && p.workDays.length);
}

export async function leaderSelfProfiles(db: PrismaClient, context: ActorContext) {
  const actor = await resolveActor(db, context);
  if (actor.role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
  const rows = await db.companyEventRegistration.findMany({
    where: { erasedAt: null, event: { status: { notIn: ["DRAFT", "ARCHIVED"] } },
      company: { deactivatedAt: null, internalOrganisation: null,
        memberships: { some: { userId: actor.userId, revokedAt: null } } } },
    orderBy: [{ event: { startDate: "desc" } }, { id: "asc" }],
    select: { id: true, company: { select: { name: true } }, event: { select: { name: true } },
      participants: { where: { internalReference: reference(actor.userId) }, select: profileSelect } },
  });
  return Promise.all(rows.map(async row => {
    const own = row.participants[0] ?? null;
    const capabilities = await registrationCapabilities(db, row.id, actor.role);
    const complete = leaderSelfProfileComplete(own);
    const withdrawn = Boolean(own && (own.erasedAt || ["REMOVED", "REPLACED"].includes(own.status)));
    // Closed/read-only historical registrations must never trap an account at
    // an onboarding form that normal event rules no longer allow them to edit.
    return { registrationId: row.id, companyName: row.company.name, eventName: row.event.name,
      participantId: own?.id ?? null, complete, canCreate: capabilities.add,
      required: capabilities.add && !complete && !withdrawn };
  }));
}

export async function ensureLeaderSelfParticipant(db: PrismaClient, context: ActorContext, registrationId: string) {
  const id = z.uuid().parse(registrationId);
  const work = () => transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    if (actor.role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    const r = await tx.companyEventRegistration.findUnique({ where: { id }, include: { company: true } });
    if (!r) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, r.companyId);
    await assertRegistrationNotErasing(tx, id);
    const marker = reference(actor.userId);
    const existing = await tx.eventParticipant.findUnique({ where: { registrationId_internalReference: { registrationId: id, internalReference: marker } } });
    if (existing) {
      if (existing.erasedAt || ["REMOVED", "REPLACED"].includes(existing.status)) throw new DomainError("EDIT_LOCKED");
      return { participantId: existing.id };
    }
    if (!(await registrationCapabilities(tx, id, actor.role)).add) throw new DomainError("EDIT_LOCKED");
    const count = await tx.eventParticipant.count({ where: { registrationId: id, status: { in: [...active] } } });
    if (count >= r.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    const p = await tx.eventParticipant.create({ data: { registrationId: id, eventId: r.eventId, internalReference: marker } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_CREATED", entityType: "EventParticipant", entityId: p.id, eventId: r.eventId, companyId: r.companyId });
    return { participantId: p.id };
  });
  try { return await work(); }
  catch (error) {
    // A concurrent identical start can hit the unique marker before Prisma's
    // serialization retry; repeat the authorised lookup, never create a second person.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return work();
    throw error;
  }
}

export async function linkLeaderSelfParticipant(db: PrismaClient, context: ActorContext, raw: { registrationId: string; participantId: string }) {
  const input = z.object({ registrationId: z.uuid(), participantId: z.uuid() }).strict().parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    if (actor.role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    const r = await tx.companyEventRegistration.findUnique({ where: { id: input.registrationId } });
    if (!r) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, r.companyId);
    await assertRegistrationNotErasing(tx, r.id);
    const marker = reference(actor.userId);
    const own = await tx.eventParticipant.findUnique({ where: { registrationId_internalReference: { registrationId: r.id, internalReference: marker } } });
    if (own && own.id !== input.participantId) throw new DomainError("INVALID_INPUT");
    const p = await tx.eventParticipant.findFirst({ where: { id: input.participantId, registrationId: r.id,
      erasedAt: null, status: { in: [...active] } } });
    if (!p || (p.internalReference && p.internalReference !== marker)) throw new DomainError("FORBIDDEN");
    if (!p.internalReference) {
      const changed = await tx.eventParticipant.updateMany({ where: { id: p.id, registrationId: r.id,
        version: p.version, internalReference: null }, data: { internalReference: marker, version: { increment: 1 } } });
      if (changed.count !== 1) throw new DomainError("STALE_WRITE");
      await appendAudit(tx, actor, { action: "PARTICIPANT_UPDATED", entityType: "EventParticipant", entityId: p.id,
        eventId: r.eventId, companyId: r.companyId, metadata: { reason: "Leader identified this existing worker record as their own." } });
    }
    return { participantId: p.id };
  });
}
