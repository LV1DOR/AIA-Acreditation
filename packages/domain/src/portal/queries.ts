import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { resolveActor, requireAdmin, requireCompany } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { effectiveEventStatus } from "../events/lifecycle.ts";
import { revealDocumentNumber } from "../participants/identity.ts";

const protectedDocumentSelect = {
  documentNumberCiphertext: true,
  documentNumberIv: true,
  documentNumberAuthTag: true,
  documentNumberKeyVersion: true,
} as const;

function revealParticipantDocument<T extends { id: string; documentNumberCiphertext: string | null; documentNumberIv: string | null; documentNumberAuthTag: string | null; documentNumberKeyVersion: number | null }>(participant: T, encryptionKey: string) {
  const { documentNumberCiphertext: _ciphertext, documentNumberIv: _iv, documentNumberAuthTag: _tag, documentNumberKeyVersion: _keyVersion, ...safe } = participant;
  void _ciphertext; void _iv; void _tag; void _keyVersion;
  return { ...safe, documentNumber: revealDocumentNumber(participant, encryptionKey) };
}

// Portal reads do not use interactive transactions. Prisma can expand relation includes into
// parallel reads, while one pg transaction client supports only one active query at a time.
// Every query remains role- or membership-scoped; mutations retain serializable transactions.
export async function adminOverview(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  const events = await db.event.count();
  const companies = await db.company.count({ where: { deactivatedAt: null } });
  const registrations = await db.companyEventRegistration.count();
  const reviewCount = await db.companyEventRegistration.count({ where: { status: "AIA_REVIEW" } });
  const requestCount = await db.companyRequest.count({ where: { status: "PENDING" } });
  const storedEvents = await db.event.findMany({ orderBy: { startDate: "desc" }, take: 20, select: { id: true, name: true, startDate: true, endDate: true, onboardingOpensAt: true, onboardingClosesAt: true, timezone: true, status: true, _count: { select: { registrations: true } } } });
  const recentEvents = storedEvents.map(event => ({ ...event, status: effectiveEventStatus(event) }));
  const pendingRows = await db.companyEventRegistration.findMany({ where: { status: "AIA_REVIEW" }, orderBy: { updatedAt: "asc" }, take: 30, select: { id: true, version: true, company: { select: { name: true } }, event: { select: { name: true } }, status: true } });
  const pendingSubmissions = pendingRows.length ? await db.companySubmission.findMany({ where: { registrationId: { in: pendingRows.map(item => item.id) } }, orderBy: [{ registrationId: "asc" }, { version: "desc" }], select: { id: true, registrationId: true, version: true, submittedAt: true } }) : [];
  const pending = pendingRows.map(item => ({ ...item, submissions: pendingSubmissions.filter(submission => submission.registrationId === item.id).slice(0, 1) }));
  return { events, companies, registrations, reviewCount, requestCount, recentEvents, pending };
}

export async function leaderOverview(db: PrismaClient, context: ActorContext, encryptionKey: string) {
  const actor = await resolveActor(db, context);
  const rows = await db.companyEventRegistration.findMany({
    where: { company: { deactivatedAt: null, memberships: { some: { userId: actor.userId, revokedAt: null } } } },
    orderBy: { event: { startDate: "desc" } },
    select: { id: true, status: true, personnelLimit: true, company: { select: { name: true } },
      event: { select: { name: true, startDate: true, endDate: true, onboardingOpensAt: true, onboardingClosesAt: true, timezone: true, status: true } },
      zones: { select: { eventZone: { select: { zone: { select: { name: true } } } } } },
      participants: { select: {
        id: true, status: true, fullName: true, dateOfBirth: true, documentType: true, ...protectedDocumentSelect,
        documentExpiryDate: true, mobileE164: true, nationalityCode: true, photoObjectKey: true, privacyAcknowledgedAt: true,
        jobRole: { select: { name: true } }, workDays: { orderBy: { workDate: "asc" }, select: { workDate: true } },
      } },
      vehiclePass: { select: { required: true, requestedQuantity: true, approvedQuantity: true } },
      submissions: { orderBy:{ version:"desc" }, take:1, select:{ id:true, version:true, submittedAt:true, reviews:{ orderBy:{ createdAt:"desc" }, take:1, select:{ outcome:true, reasonCategory:true, comment:true, createdAt:true } } } },
    },
  });
  return rows.map(row => ({ ...row, participants: row.participants.map(participant => revealParticipantDocument(participant, encryptionKey)), event: { ...row.event, status: effectiveEventStatus(row.event) } }));
}

export async function auditOverview(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  return db.auditEvent.findMany({ orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, occurredAt: true, action: true, actorType: true, entityType: true, entityId: true } });
}

export async function notificationOverview(db: PrismaClient, context: ActorContext) {
  const actor = await resolveActor(db, context);
  return db.notification.findMany({ where: { recipientUserId: actor.userId }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, type: true, createdAt: true, readAt: true } });
}

export async function adminSetup(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  const events = await db.event.findMany({ orderBy: [{ startDate: "desc" }, { name: "asc" }], include: { zones: { include: { zone: true }, orderBy: { zone: { sortOrder: "asc" } } } } });
  const zones = await db.zone.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const jobRoles = await db.jobRole.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const companies = await db.company.findMany({ orderBy: { name: "asc" } });
  const registrations = await db.companyEventRegistration.findMany({ orderBy: [{ event: { startDate: "desc" } }, { company: { name: "asc" } }], include: {
    company: true, event: true,
    invitations: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true, emailNormalized: true, expiresAt: true, usedAt: true, revokedAt: true } },
  } });
  return { events, zones, jobRoles, companies, registrations };
}

export async function leaderRegistration(db: PrismaClient, context: ActorContext, registrationId: string, encryptionKey: string) {
  const actor = await resolveActor(db, context);
  const registration = await db.companyEventRegistration.findFirst({ where: {
    id: registrationId,
    company: actor.role === "ADMIN"
      ? { deactivatedAt: null }
      : { deactivatedAt: null, memberships: { some: { userId: actor.userId, revokedAt: null } } },
  }, include: {
    company: true,
    event: { include: { zones: { where: { deactivatedAt: null, zone: { deactivatedAt: null } }, include: { zone: true }, orderBy: { zone: { sortOrder: "asc" } } } } },
    zones: true, participants: { orderBy: { createdAt: "asc" }, select: {
      id: true, status: true, fullName: true, dateOfBirth: true, documentType: true, ...protectedDocumentSelect,
      documentExpiryDate: true, mobileE164: true, nationalityCode: true, photoObjectKey: true, privacyAcknowledgedAt: true,
      createdAt: true, jobRole: { select: { name: true } }, workDays: { orderBy: { workDate: "asc" }, select: { workDate: true } },
      replacementRequest: { select:{ status:true, fulfilledBySubmissionId:true } },
      employeeTokens: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, expiresAt: true, usedAt: true, revokedAt: true } },
    } },
    vehiclePass: true,
    requests: { where:{ status:"APPROVED", fulfilledBySubmissionId:null }, select:{ id:true, type:true } },
  } });
  if (!registration) throw new DomainError("FORBIDDEN");
  const submissionRows = await db.companySubmission.findMany({ where: { registrationId: registration.id }, orderBy: { version: "desc" }, take: 10 });
  const reviewRows = submissionRows.length ? await db.companySubmissionReview.findMany({ where: { submissionId: { in: submissionRows.map(item => item.id) } }, orderBy: { createdAt: "asc" }, select: { id: true, submissionId: true, outcome: true, reasonCategory: true, comment: true, createdAt: true } }) : [];
  return { ...registration, participants: registration.participants.map(participant => revealParticipantDocument(participant, encryptionKey)), submissions: submissionRows.map(submission => ({ ...submission, reviews: reviewRows.filter(review => review.submissionId === submission.id) })) };
}

export async function adminSubmission(db: PrismaClient, context: ActorContext, submissionId: string) {
  requireAdmin(await resolveActor(db, context));
  const submission = await db.companySubmission.findUnique({ where: { id: submissionId } });
  if (!submission) throw new DomainError("INVALID_INPUT");
  const registration = await db.companyEventRegistration.findUniqueOrThrow({ where: { id: submission.registrationId } });
  const company = await db.company.findUniqueOrThrow({ where: { id: registration.companyId } });
  const event = await db.event.findUniqueOrThrow({ where: { id: registration.eventId } });
  const submissionVersions = await db.companySubmission.findMany({ where: { registrationId: registration.id }, orderBy: { version: "desc" }, select: { id: true, version: true } });
  const reviews = await db.companySubmissionReview.findMany({ where: { submissionId }, orderBy: { createdAt: "asc" }, select: { id: true, outcome: true, reasonCategory: true, comment: true, createdAt: true, reviewedByUserId: true } });
  return { ...submission, registration: { ...registration, company, event, submissions: submissionVersions }, reviews };
}

export async function leaderParticipant(db: PrismaClient, context: ActorContext, participantId: string, encryptionKey: string) {
  const actor = await resolveActor(db, context);
  const participant = await db.eventParticipant.findFirst({ where: {
    id: participantId,
    registration: { company: { memberships: { some: { userId: actor.userId, revokedAt: null } } } },
  }, select: {
    id: true, registrationId: true, eventId: true, status: true, fullName: true, dateOfBirth: true,
    documentType: true, ...protectedDocumentSelect, documentExpiryDate: true, mobileE164: true,
    nationalityCode: true, jobRoleId: true, photoObjectKey: true, privacyAcknowledgedAt: true,
    replacementRequestId:true, replacementRequest:{ select:{ status:true, fulfilledBySubmissionId:true } },
    registration: { select: { status: true, company: { select: { name: true } }, event: true } },
    workDays: { orderBy: { workDate: "asc" } },
  } });
  if (!participant) throw new DomainError("FORBIDDEN");
  const jobRoles = await db.jobRole.findMany({ where: { deactivatedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  return { participant: revealParticipantDocument(participant, encryptionKey), jobRoles };
}

export async function adminDuplicateReview(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  const participants = await db.eventParticipant.findMany({ where: { status: "DUPLICATE_REVIEW_REQUIRED" }, orderBy: { updatedAt: "asc" }, include: { registration: { include: { company: true, event: true } } } });
  return Promise.all(participants.map(async participant => ({
    id: participant.id, fullName: participant.fullName, documentNumberLast3: participant.documentNumberLast3,
    companyName: participant.registration.company.name, eventName: participant.registration.event.name,
    conflicts: participant.documentNumberFingerprint ? await db.eventParticipant.findMany({ where: {
      eventId: participant.eventId, documentNumberFingerprint: participant.documentNumberFingerprint, id: { not: participant.id }, status: { notIn: ["REMOVED", "REPLACED"] },
    }, select: { id: true, fullName: true, documentNumberLast3: true, registration: { select: { company: { select: { name: true } } } } } }) : [],
  })));
}

export async function participantPhotoAccess(db: PrismaClient, context: ActorContext, participantId: string) {
  const actor = await resolveActor(db, context);
  const participant = await db.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: true } });
  if (!participant?.photoObjectKey) throw new DomainError("FORBIDDEN");
  await requireCompany(db, actor, participant.registration.companyId);
  return participant.photoObjectKey;
}
