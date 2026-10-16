import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireCompany, resolveActor } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction, type Tx } from "../shared/transaction.ts";
import { assertParticipantLeaderCanEdit, employeeInvitationView } from "./service.ts";

export async function prepareLeaderPhotoUpload(db: PrismaClient, context: ActorContext, participantId: string, bucket: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    const capabilities = await assertParticipantLeaderCanEdit(tx, participant, actor.role);
    if (!capabilities.fields.includes("PHOTO")) throw new DomainError("EDIT_LOCKED");
    return stagePhotoUpload(tx, participant, bucket);
  });
}

export async function prepareEmployeePhotoUpload(db: PrismaClient, token: string, bucket: string) {
  const invitation = await employeeInvitationView(db, token);
  return stagePhotoUpload(db, { id: invitation.participantId, version: invitation.participantVersion, eventId: invitation.eventId, registrationId: invitation.registrationId }, bucket);
}

export async function stagePhotoUpload(tx: Pick<Tx, "photoUpload">, participant: { id: string; version: number; eventId: string; registrationId: string }, bucket: string, submissionId?: string) {
  const id = randomUUID();
  return tx.photoUpload.create({ data: {
    id, participantId: participant.id, participantVersion: participant.version, submissionId, bucket,
    objectKey: `photos/${participant.eventId}/${participant.registrationId}/${participant.id}/${submissionId ? `submission-adjustments/${submissionId}` : "versions"}/${id}.jpg`,
    expiresAt: new Date(Date.now() + 86_400_000),
  } });
}

export async function adoptPhotoUpload(tx: Tx, objectKey: string, participant: { id: string; version: number }, submissionId: string | null = null) {
  const upload = await tx.photoUpload.findUnique({ where: { objectKey } });
  if (!upload || upload.participantId !== participant.id || upload.participantVersion !== participant.version || upload.submissionId !== submissionId) throw new DomainError("STALE_WRITE");
  const changed = await tx.photoUpload.updateMany({ where: { id: upload.id, status: "STAGED", expiresAt: { gt: new Date() } }, data: { status: "ADOPTED" } });
  if (changed.count !== 1) throw new DomainError("STALE_WRITE");
}

export async function abandonPhotoUpload(db: PrismaClient, objectKey: string) {
  // If a commit succeeded but its acknowledgement was lost, ADOPTED prevents deletion.
  await db.photoUpload.updateMany({ where: { objectKey, status: "STAGED" }, data: { expiresAt: new Date(Date.now() + 300_000) } });
}

export async function cleanupNextPhotoUpload(db: PrismaClient, deletePhoto: (bucket: string, key: string) => Promise<void>, now = new Date()) {
  const upload = await transaction(db, async tx => {
    const row = await tx.photoUpload.findFirst({ where: { status: { in: ["STAGED", "CLEANING"] }, expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" } });
    if (!row) return null;
    return tx.photoUpload.update({ where: { id: row.id }, data: { status: "CLEANING", expiresAt: new Date(now.getTime() + 60_000), attempts: { increment: 1 } } });
  });
  if (!upload) return "IDLE";
  try {
    await deletePhoto(upload.bucket, upload.objectKey);
    await db.photoUpload.updateMany({ where: { id: upload.id, status: "CLEANING" }, data: { status: "CLEANED" } });
    return "CLEANED";
  } catch { return "RETRY"; }
}
