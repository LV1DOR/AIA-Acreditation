import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { appendAudit } from "../audit/append.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { adoptPhotoUpload, stagePhotoUpload } from "../participants/photo-lifecycle.ts";
import { decryptSubmissionSnapshot } from "./snapshot-crypto.ts";

const adjustmentInput = z.object({
  submissionId: z.uuid(),
  participantId: z.uuid(),
  photoObjectKey: z.string().min(1).max(1000),
}).strict();

export async function recordSubmissionPhotoAdjustment(db: PrismaClient, context: ActorContext, raw: z.input<typeof adjustmentInput>) {
  const input = adjustmentInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const submission = await tx.companySubmission.findUnique({ where: { id: input.submissionId } });
    if (!submission) throw new DomainError("INVALID_INPUT");
    const registration = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: submission.registrationId } });
    const latest = await tx.companySubmission.findFirst({ where: { registrationId: registration.id }, orderBy: { version: "desc" }, select: { id: true } });
    if (registration.status !== "AIA_REVIEW" || latest?.id !== submission.id) throw new DomainError("EDIT_LOCKED");
    const participant = await tx.eventParticipant.findFirst({ where: { id: input.participantId, registrationId: registration.id, status: { notIn: ["REMOVED", "REPLACED"] }, photoObjectKey: { not: null } } });
    if (!participant) throw new DomainError("INVALID_INPUT");
    const adjustmentVersion = 1 + await tx.submissionPhotoAdjustment.count({ where: { submissionId: submission.id, participantId: participant.id } });
    await adoptPhotoUpload(tx, input.photoObjectKey, { id: participant.id, version: adjustmentVersion }, submission.id);
    const adjustment = await tx.submissionPhotoAdjustment.create({ data: { submissionId: submission.id, participantId: participant.id, photoObjectKey: input.photoObjectKey, adjustedByUserId: actor.userId } });
    await appendAudit(tx, actor, { action: "SUBMISSION_PHOTO_ADJUSTED", entityType: "SubmissionPhotoAdjustment", entityId: adjustment.id, eventId: participant.eventId, companyId: registration.companyId, metadata: { version: submission.version } });
    return adjustment;
  });
}

export async function adminSubmissionPhotoAccess(db: PrismaClient, context: ActorContext, submissionId: string, participantId: string, encryptionKey: string, original = false) {
  const actor = await resolveActor(db, context); requireAdmin(actor);
  const submission = await db.companySubmission.findUnique({ where: { id: submissionId } });
  if (!submission) throw new DomainError("FORBIDDEN");
  const snapshot = z.object({ participants: z.array(z.object({ id: z.string(), photoObjectKey: z.string().nullable() })) }).parse(decryptSubmissionSnapshot(submission.snapshot, encryptionKey, submissionId));
  const source = snapshot.participants.find(person => person.id === participantId)?.photoObjectKey;
  if (!source) throw new DomainError("FORBIDDEN");
  const adjustment = await db.submissionPhotoAdjustment.findFirst({ where: { submissionId, participantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { photoObjectKey: true } });
  return !original && adjustment ? adjustment.photoObjectKey : source;
}

export async function prepareSubmissionPhotoUpload(db: PrismaClient, context: ActorContext, submissionId: string, participantId: string, bucket: string) {
  return transaction(db, async tx => {
    const target = await adminSubmissionPhotoTarget(tx, context, submissionId, participantId);
    const version = 1 + await tx.submissionPhotoAdjustment.count({ where: { submissionId, participantId } });
    return stagePhotoUpload(tx, { ...target, id: participantId, version }, bucket, submissionId);
  });
}

export async function adminSubmissionPhotoTarget(db: Pick<PrismaClient, "user" | "companySubmission" | "eventParticipant">, context: ActorContext, submissionId: string, participantId: string) {
  const actor = await resolveActor(db, context); requireAdmin(actor);
  const submission = await db.companySubmission.findUnique({ where: { id: submissionId }, select: { id: true, registrationId: true, registration: { select: { status: true, eventId: true } } } });
  if (!submission || submission.registration.status !== "AIA_REVIEW") throw new DomainError("EDIT_LOCKED");
  const latest = await db.companySubmission.findFirst({ where: { registrationId: submission.registrationId }, orderBy: { version: "desc" }, select: { id: true } });
  const participant = await db.eventParticipant.findFirst({ where: { id: participantId, registrationId: submission.registrationId, status: { notIn: ["REMOVED", "REPLACED"] }, photoObjectKey: { not: null } }, select: { id: true } });
  if (latest?.id !== submission.id || !participant) throw new DomainError("EDIT_LOCKED");
  return { eventId: submission.registration.eventId, registrationId: submission.registrationId, participantId: participant.id };
}
