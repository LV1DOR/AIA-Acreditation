import { assertRegistrationActive } from "../auth/authorization.ts";
import { assertRegistrationNotErasing, recordPrivacyAcknowledgement } from "../privacy/notices.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, ReviewReasonCategory, type PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { appendAudit } from "../audit/append.ts";
import { requireAdmin, requireCompany, resolveActor } from "../auth/authorization.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { recordNotification, recordNotifications } from "../notifications/record.ts";
import { queueBusinessEmail } from "../notifications/business-email.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { transition } from "./state-machine.ts";
import { decryptSubmissionSnapshot, encryptSubmissionSnapshot } from "./snapshot-crypto.ts";
import { validateRegistrationEligibility } from "./eligibility.ts";

const submitInput = z.object({
  registrationId: z.uuid(), expectedVersion: z.number().int().positive(),
  dataProcessingAccepted: z.literal(true), dataProcessingNoticeVersion: z.string().trim().min(1).max(100),
  dataProcessingNoticeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),noticeLocale:z.enum(["pt","en"]).optional(),
}).strict();
const reviewInput = z.discriminatedUnion("action", [
  z.object({ submissionId: z.uuid(), expectedRegistrationVersion: z.number().int().positive(), action: z.literal("APPROVE") }).strict(),
  z.object({ submissionId: z.uuid(), expectedRegistrationVersion: z.number().int().positive(), action: z.literal("RETURN"), reason: z.enum(ReviewReasonCategory), comment: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ submissionId: z.uuid(), expectedRegistrationVersion: z.number().int().positive(), action: z.literal("REJECT"), reason: z.enum(ReviewReasonCategory), comment: z.string().trim().min(1).max(4000) }).strict(),
]);
const reopenInput = z.object({ registrationId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();
const participantReviewInput = z.discriminatedUnion("outcome", [
  z.object({ submissionId:z.uuid(), participantId:z.uuid(), outcome:z.literal("APPROVED") }).strict(),
  z.object({ submissionId:z.uuid(), participantId:z.uuid(), outcome:z.literal("RETURNED_FOR_CORRECTION"), reason:z.enum(ReviewReasonCategory), comment:z.string().trim().min(1).max(1000) }).strict(),
]);

const approvalSnapshotSchema = z.object({
  participants: z.array(z.object({
    id: z.uuid(), fullName: z.string().nullable(), dateOfBirth: z.string().nullable(),
    documentType: z.string().nullable(), documentNumberFingerprint: z.string().nullable(),
    documentExpiryDate: z.string().nullable(), mobileE164: z.string().nullable(),
    nationalityCode: z.string().nullable(), photoObjectKey: z.string().nullable(),
    privacyNoticeVersion: z.string().nullable(),
    jobRole: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    zones: z.array(z.object({ id: z.uuid(), name: z.string() })), workDays: z.array(z.string()),
  })),
});

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function sameReviewedParticipant(previous: z.infer<typeof approvalSnapshotSchema>["participants"][number], current: z.infer<typeof approvalSnapshotSchema>["participants"][number]) {
  // Ignore workflow status/version and randomized document-encryption bytes.
  // The fingerprint and reviewable fields capture whether the submitted person changed.
  return JSON.stringify(previous) === JSON.stringify(current);
}

function immutableSnapshot(registration: Awaited<ReturnType<typeof loadRegistration>>, declaration: { noticeVersion: string; acknowledgedAt: Date; submittedByUserId: string }) {
  return {
    schemaVersion: 2,
    registration: { id: registration.id, version: registration.version, personnelLimit: registration.personnelLimit },
    company: { id: registration.company.id, name: registration.company.name, internalOrganisation: registration.company.internalOrganisation },
    event: {
      id: registration.event.id,
      name: registration.event.name,
      startDate: iso(registration.event.startDate),
      endDate: iso(registration.event.endDate),
      onboardingOpensAt: iso(registration.event.onboardingOpensAt),
      onboardingClosesAt: iso(registration.event.onboardingClosesAt),
      timezone: registration.event.timezone,
    },
    zones: registration.zones.map(item => ({ id: item.zoneId, name: item.eventZone.zone.name })),
    vehiclePass: registration.vehiclePass ? {
      required: registration.vehiclePass.required,
      requestedQuantity: registration.vehiclePass.requestedQuantity,
      justification: registration.vehiclePass.justification,
    } : { required: false, requestedQuantity: 0, justification: null },
    dataProcessingDeclaration: {
      noticeVersion: declaration.noticeVersion,
      acknowledgedAt: declaration.acknowledgedAt.toISOString(),
      submittedByUserId: declaration.submittedByUserId,
    },
    participants: registration.participants.filter(item => !["REMOVED", "REPLACED"].includes(item.status)).map(item => ({
      id: item.id,
      version: item.version,
      status: item.status,
      fullName: item.fullName,
      dateOfBirth: iso(item.dateOfBirth),
      documentType: item.documentType,
      documentNumberCiphertext: item.documentNumberCiphertext,
      documentNumberIv: item.documentNumberIv,
      documentNumberAuthTag: item.documentNumberAuthTag,
      documentNumberKeyVersion: item.documentNumberKeyVersion,
      documentNumberFingerprint: item.documentNumberFingerprint,
      documentNumberLast3: item.documentNumberLast3,
      documentExpiryDate: iso(item.documentExpiryDate),
      mobileE164: item.mobileE164,
      nationalityCode: item.nationalityCode,
      photoObjectKey: item.photoObjectKey,
      privacyNoticeVersion: item.privacyNoticeVersion,
      privacyAcknowledgedAt: iso(item.privacyAcknowledgedAt),
      jobRole: item.jobRole ? { id: item.jobRole.id, name: item.jobRole.name } : null,
      zones: item.individualZones.map(z => ({id:z.zoneId,name:z.eventZone.zone.name})),
      workDays: item.workDays.map(day => iso(day.workDate)),
    })),
  } satisfies Prisma.JsonObject;
}

async function loadRegistration(tx: Prisma.TransactionClient, registrationId: string) {
  const registration = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: registrationId } });
  const company = await tx.company.findUniqueOrThrow({ where: { id: registration.companyId } });
  const event = await tx.event.findUniqueOrThrow({ where: { id: registration.eventId } });
  const zoneRequests = await tx.companyZoneRequest.findMany({ where: { registrationId }, orderBy: { zoneId: "asc" } });
  const zoneRows = zoneRequests.length ? await tx.zone.findMany({ where: { id: { in: zoneRequests.map(item => item.zoneId) } } }) : [];
  const zones = zoneRequests.map(request => ({ ...request, eventZone: { zone: zoneRows.find(zone => zone.id === request.zoneId)! } }));
  const vehiclePass = await tx.vehiclePassRequest.findUnique({ where: { registrationId } });
  const participantRows = await tx.eventParticipant.findMany({ where: { registrationId }, include: { individualZones: { include: { eventZone: { include: { zone: true } } } } }, orderBy: { id: "asc" } });
  const roleIds = [...new Set(participantRows.map(item => item.jobRoleId).filter((id): id is string => Boolean(id)))];
  const roleRows = roleIds.length ? await tx.jobRole.findMany({ where: { id: { in: roleIds } } }) : [];
  const workDayRows = participantRows.length ? await tx.participantWorkDay.findMany({ where: { participantId: { in: participantRows.map(item => item.id) } }, orderBy: { workDate: "asc" } }) : [];
  const participants = participantRows.map(participant => ({ ...participant, jobRole: roleRows.find(role => role.id === participant.jobRoleId) ?? null, workDays: workDayRows.filter(day => day.participantId === participant.id) }));
  const primaryLeader = registration.primaryLeaderMembershipId ? await tx.companyLeaderMembership.findUnique({ where: { id: registration.primaryLeaderMembershipId } }) : null;
  return { ...registration, company, event, zones, vehiclePass, participants, primaryLeader };
}

export async function submitCompanyRegistration(db: PrismaClient, context: ActorContext, raw: z.input<typeof submitInput>, encryptionKey: string) {
  const input = submitInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await loadRegistration(tx, input.registrationId).catch(() => null);
    if (!registration) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, registration.companyId);
    await assertRegistrationNotErasing(tx,registration.id);
    if (registration.company.internalOrganisation ? actor.role !== "ADMIN" : actor.role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    const approvedRequests = await tx.companyRequest.findMany({ where:{ registrationId:registration.id, status:"APPROVED", fulfilledBySubmissionId:null }, select:{ id:true } });
    const latestReviewedSubmission = registration.status === "RETURNED_FOR_CORRECTION" ? await tx.companySubmission.findFirst({ where:{ registrationId:registration.id }, orderBy:{ version:"desc" }, select:{ reviews:{ orderBy:{ createdAt:"desc" }, take:1, select:{ outcome:true } } } }) : null;
    const correctionWindow = registration.status === "RETURNED_FOR_CORRECTION" && (approvedRequests.length > 0 || ["RETURNED_FOR_CORRECTION", "APPROVAL_INVALIDATED"].includes(latestReviewedSubmission?.reviews[0]?.outcome ?? ""));
    const internalWindow = registration.company.internalOrganisation && actor.role === "ADMIN" && ["DRAFT","RETURNED_FOR_CORRECTION"].includes(registration.status);
    const next = correctionWindow || internalWindow ? { status:"AIA_REVIEW" as const } : transition(registration, actor.role, { action: "SUBMIT" }, new Date());
    const active = registration.participants.filter(item => !["REMOVED", "REPLACED"].includes(item.status));
    if (!active.length || active.length > registration.personnelLimit || active.some(item => item.status !== "LEADER_APPROVED")) throw new DomainError("SUBMISSION_INCOMPLETE");
    await validateRegistrationEligibility(tx, registration.id);
    const acknowledgement=await recordPrivacyAcknowledgement(tx,{eventId:registration.eventId,registrationId:registration.id,actorType:actor.role,actorUserId:actor.userId,kind:"LEADER",version:input.dataProcessingNoticeVersion,locale:input.noticeLocale,presentedHash:input.dataProcessingNoticeHash});
    const acknowledgedAt = acknowledgement.acknowledgedAt;
    const snapshot = {...immutableSnapshot(registration, { noticeVersion: acknowledgement.noticeVersion, acknowledgedAt, submittedByUserId: actor.userId }),declarationEvidence:{acknowledgementId:acknowledgement.id,noticeHash:acknowledgement.noticeHash,presentedText:acknowledgement.presentedText,locale:acknowledgement.locale}};
    const serialized = JSON.stringify(snapshot);
    const submissionId = randomUUID();
    const latest = await tx.companySubmission.aggregate({ where: { registrationId: registration.id }, _max: { version: true } });
    const submissionVersion = (latest._max.version ?? 0) + 1;
    const changed = await tx.companyEventRegistration.updateMany({ where: { id: registration.id, version: input.expectedVersion, status: registration.status }, data: { status: next.status, version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    await tx.employeeInvitationToken.updateMany({ where: { participant: { registrationId: registration.id }, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const submission = await tx.companySubmission.create({ data: {
      id: submissionId,
      registrationId: registration.id,
      version: submissionVersion,
      registrationVersion: input.expectedVersion,
      snapshot: encryptSubmissionSnapshot(serialized, encryptionKey, submissionId),
      contentHash: createHash("sha256").update(serialized).digest("hex"),
      submittedByUserId: actor.userId,
    } });
    const previousSubmission = await tx.companySubmission.findFirst({
      where: { registrationId: registration.id, version: { lt: submissionVersion } },
      orderBy: { version: "desc" },
      select: {
        id: true, snapshot: true,
        participantReviews: { where: { outcome: "APPROVED" }, select: { participantId: true, reviewedByUserId: true } },
        photoAdjustments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { participantId: true, photoObjectKey: true, adjustedByUserId: true } },
      },
    });
    let inheritedApprovalCount = 0;
    if (previousSubmission) {
      const previousPeople = new Map(approvalSnapshotSchema.parse(decryptSubmissionSnapshot(previousSubmission.snapshot, encryptionKey, previousSubmission.id)).participants.map(person => [person.id, person]));
      const currentPeople = new Map(approvalSnapshotSchema.parse(snapshot).participants.map(person => [person.id, person]));
      const inherited = previousSubmission.participantReviews.flatMap(review => {
        const previousPerson = previousPeople.get(review.participantId);
        const currentPerson = currentPeople.get(review.participantId);
        return previousPerson && currentPerson && sameReviewedParticipant(previousPerson, currentPerson)
          ? [{ participantId: review.participantId, reviewedByUserId: review.reviewedByUserId }]
          : [];
      });
      inheritedApprovalCount = inherited.length;
      if (inherited.length) {
        await tx.submissionParticipantReview.createMany({
          data: inherited.map(review => ({ submissionId: submission.id, ...review, outcome: "APPROVED" as const })),
        });
        const inheritedIds = new Set(inherited.map(review => review.participantId));
        const carriedPhotoIds = new Set<string>();
        const carriedPhotos = previousSubmission.photoAdjustments.flatMap(adjustment => {
          if (!inheritedIds.has(adjustment.participantId) || carriedPhotoIds.has(adjustment.participantId)) return [];
          carriedPhotoIds.add(adjustment.participantId);
          return [{ submissionId: submission.id, ...adjustment }];
        });
        if (carriedPhotos.length) await tx.submissionPhotoAdjustment.createMany({ data: carriedPhotos });
      }
    }
    await tx.privacyAcknowledgement.update({where:{id:acknowledgement.id},data:{submissionId:submission.id}});
    if (approvedRequests.length) await tx.companyRequest.updateMany({ where:{ id:{ in:approvedRequests.map(request => request.id) }, fulfilledBySubmissionId:null }, data:{ fulfilledBySubmissionId:submission.id } });
    await appendAudit(tx, actor, { action: "SUBMISSION_CREATED", entityType: "CompanySubmission", entityId: submission.id, eventId: registration.eventId, companyId: registration.companyId, metadata: { version: submissionVersion, ...(inheritedApprovalCount ? { inheritedApprovals: { fromSubmissionId: previousSubmission!.id, participantCount: inheritedApprovalCount } } : {}) } });
    await enqueueInvalidation(tx, `submission:${submission.id}:created`, { entityId: submission.id, eventId: registration.eventId, version: submissionVersion });
    await queueBusinessEmail(tx, `submission:${submission.id}:receipt-email`, { recipientUserId: actor.userId, template: "SUBMISSION_RECEIVED", companyName: registration.company.name, eventName: registration.event.name, path: "/portal" });
    const admins = await tx.user.findMany({ where: { role: "ADMIN", disabledAt: null }, select: { id: true } });
    await recordNotifications(tx,admins.map(admin=>({ recipientUserId: admin.id, eventId: registration.eventId, registrationId: registration.id, type: "SUBMISSION_RECEIVED" as const, deduplicationKey: `submission:${submission.id}:received:${admin.id}`, parameters: { submissionId: submission.id, submissionVersion } })));
    return submission;
  });
}

export async function reviewCompanySubmission(db: PrismaClient, context: ActorContext, raw: z.input<typeof reviewInput>) {
  const input = reviewInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const submissionRow = await tx.companySubmission.findUnique({ where: { id: input.submissionId } });
    if (!submissionRow) throw new DomainError("INVALID_INPUT");
    const registrationRow = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: submissionRow.registrationId } });
    const event = await tx.event.findUniqueOrThrow({ where: { id: registrationRow.eventId } });
    const primaryLeader = registrationRow.primaryLeaderMembershipId ? await tx.companyLeaderMembership.findUnique({ where: { id: registrationRow.primaryLeaderMembershipId } }) : null;
    assertRegistrationActive(registrationRow);
    const submission = { ...submissionRow, registration: { ...registrationRow, event, primaryLeader } };
    const command = input.action === "APPROVE" ? { action: "APPROVE" as const } : { action: input.action, reason: input.reason, comment: input.comment };
    const next = transition(submission.registration, actor.role, command, new Date());
    const latest = await tx.companySubmission.findFirst({ where: { registrationId: submission.registrationId }, orderBy: { version: "desc" }, select: { id: true } });
    if (latest?.id !== submission.id) throw new DomainError("STALE_WRITE");
    const activeParticipants = await tx.eventParticipant.findMany({ where:{ registrationId:submission.registrationId, status:{ notIn:["REMOVED","REPLACED"] } }, select:{ id:true } });
    const participantReviews = await tx.submissionParticipantReview.findMany({ where:{ submissionId:submission.id }, select:{ participantId:true, outcome:true } });
    if (input.action === "APPROVE" && (participantReviews.length !== activeParticipants.length || participantReviews.some(review => review.outcome !== "APPROVED"))) throw new DomainError("SUBMISSION_INCOMPLETE");
    if (input.action === "APPROVE") await validateRegistrationEligibility(tx, submission.registrationId);
    if (input.action === "RETURN" && participantReviews.length > 0 && participantReviews.length !== activeParticipants.length) throw new DomainError("SUBMISSION_INCOMPLETE");
    const changed = await tx.companyEventRegistration.updateMany({ where: { id: submission.registrationId, version: input.expectedRegistrationVersion, status: "AIA_REVIEW" }, data: { status: next.status, version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    if (input.action === "RETURN") {
      const returnedIds = participantReviews.filter(review => review.outcome === "RETURNED_FOR_CORRECTION").map(review => review.participantId);
      if (returnedIds.length) await tx.eventParticipant.updateMany({ where:{ id:{ in:returnedIds }, registrationId:submission.registrationId, status:"LEADER_APPROVED" }, data:{ status:"AWAITING_LEADER_REVIEW", version:{ increment:1 } } });
    }
    const outcome = input.action === "APPROVE" ? "APPROVED" : input.action === "RETURN" ? "RETURNED_FOR_CORRECTION" : "REJECTED";
    const review = await tx.companySubmissionReview.create({ data: {
      submissionId: submission.id,
      outcome,
      reasonCategory: input.action === "APPROVE" ? null : input.reason,
      comment: input.action === "APPROVE" ? null : input.comment,
      reviewedByUserId: actor.userId,
    } });
    await appendAudit(tx, actor, { action: `SUBMISSION_${input.action === "RETURN" ? "RETURNED" : outcome}` as "SUBMISSION_APPROVED" | "SUBMISSION_RETURNED" | "SUBMISSION_REJECTED", entityType: "CompanySubmission", entityId: submission.id, eventId: submission.registration.eventId, companyId: submission.registration.companyId, metadata: { version: submission.version, ...(input.action === "APPROVE" ? {} : { reasonCategory: input.reason }) } });
    const key = `submission:${submission.id}:review:${review.id}`;
    await enqueueInvalidation(tx, key, { entityId: submission.id, eventId: submission.registration.eventId, version: submission.version });
    if (submission.registration.primaryLeader && !submission.registration.primaryLeader.revokedAt) {
      await recordNotification(tx, { recipientUserId: submission.registration.primaryLeader.userId, eventId: submission.registration.eventId, registrationId: submission.registration.id, type: "REGISTRATION_UPDATED", deduplicationKey: key, parameters: { updateKind: outcome, reasonCategory: input.action === "APPROVE" ? null : input.reason } });
    }
    return review;
  });
}

export async function reviewSubmissionParticipant(db: PrismaClient, context: ActorContext, raw: z.input<typeof participantReviewInput>) {
  const input=participantReviewInput.parse(raw);
  return transaction(db, async tx => {
    const actor=await resolveActor(tx,context); requireAdmin(actor);
    const submission=await tx.companySubmission.findUnique({ where:{ id:input.submissionId }, include:{ registration:true } });
    if (!submission || submission.registration.status !== "AIA_REVIEW") throw new DomainError("EDIT_LOCKED");
    const latest=await tx.companySubmission.findFirst({ where:{ registrationId:submission.registrationId }, orderBy:{ version:"desc" }, select:{ id:true } });
    if (latest?.id !== submission.id) throw new DomainError("STALE_WRITE");
    const participant=await tx.eventParticipant.findFirst({ where:{ id:input.participantId, registrationId:submission.registrationId, status:{ notIn:["REMOVED","REPLACED"] } }, select:{ id:true } });
    if (!participant) throw new DomainError("INVALID_INPUT");
    const data=input.outcome === "APPROVED"
      ? { outcome:input.outcome, reasonCategory:null, comment:null, reviewedByUserId:actor.userId }
      : { outcome:input.outcome, reasonCategory:input.reason, comment:input.comment, reviewedByUserId:actor.userId };
    const review=await tx.submissionParticipantReview.upsert({ where:{ submissionId_participantId:{ submissionId:submission.id, participantId:participant.id } }, create:{ submissionId:submission.id, participantId:participant.id, ...data }, update:data });
    await appendAudit(tx,actor,{ action:input.outcome === "APPROVED" ? "SUBMISSION_PARTICIPANT_APPROVED":"SUBMISSION_PARTICIPANT_RETURNED", entityType:"SubmissionParticipantReview", entityId:review.id, eventId:submission.registration.eventId, companyId:submission.registration.companyId, metadata:{ version:submission.version, ...(input.outcome === "APPROVED" ? {}:{ reasonCategory:input.reason }) } });
    await enqueueInvalidation(tx,`submission:${submission.id}:participant:${participant.id}:${review.updatedAt.toISOString()}`,{entityId:submission.id,eventId:submission.registration.eventId,version:submission.version});
    return review;
  });
}

export async function reopenApprovedRegistration(db: PrismaClient, context: ActorContext, raw: z.input<typeof reopenInput>) {
  const input = reopenInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registrationRow = await tx.companyEventRegistration.findUnique({ where: { id: input.registrationId } });
    if (!registrationRow) throw new DomainError("FORBIDDEN");
    const event = await tx.event.findUniqueOrThrow({ where: { id: registrationRow.eventId } });
    assertRegistrationActive(registrationRow);
    const registration = { ...registrationRow, event };
    await requireCompany(tx, actor, registration.companyId);
    const next = transition(registration, actor.role, { action: "REOPEN" }, new Date());
    const submission = await tx.companySubmission.findFirst({ where: { registrationId: registration.id }, orderBy: { version: "desc" } });
    if (!submission) throw new DomainError("INVALID_TRANSITION");
    const changed = await tx.companyEventRegistration.updateMany({ where: { id: registration.id, version: input.expectedVersion, status: "APPROVED" }, data: { status: next.status, version: { increment: 1 } } });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    await tx.companySubmissionReview.create({ data: { submissionId: submission.id, outcome: "APPROVAL_INVALIDATED", reviewedByUserId: actor.userId } });
    await appendAudit(tx, actor, { action: "SUBMISSION_REOPENED", entityType: "CompanySubmission", entityId: submission.id, eventId: registration.eventId, companyId: registration.companyId, metadata: { version: submission.version } });
    await enqueueInvalidation(tx, `submission:${submission.id}:reopened:${input.expectedVersion + 1}`, { entityId: submission.id, eventId: registration.eventId, version: submission.version });
    return { registrationId: registration.id, version: input.expectedVersion + 1 };
  });
}
