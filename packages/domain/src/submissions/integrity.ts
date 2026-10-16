import type { ResolvedActor } from "../auth/authorization.ts";
import type { Tx } from "../shared/transaction.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { recordNotification } from "../notifications/record.ts";

// An amendment decision authorises a change; a new submission approves its effective content.
export async function invalidateEffectiveApproval(tx: Tx, actor: ResolvedActor, registrationId: string) {
  const registration = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { primaryLeader: true } });
  if (!["APPROVED", "AIA_REVIEW"].includes(registration.status)) return;
  const submission = await tx.companySubmission.findFirst({ where: { registrationId }, orderBy: { version: "desc" } });
  if (registration.status === "APPROVED" && submission) await tx.companySubmissionReview.create({ data: { submissionId: submission.id, outcome: "APPROVAL_INVALIDATED", reviewedByUserId: actor.userId } });
  if (registration.status === "AIA_REVIEW" && submission) await tx.companySubmissionReview.create({ data: { submissionId: submission.id, outcome: "RETURNED_FOR_CORRECTION", reasonCategory: "OTHER", comment: "Registration requirements changed; submit a new version for AIA review.", reviewedByUserId: actor.userId } });
  const updated = await tx.companyEventRegistration.update({ where: { id: registrationId }, data: { status: "RETURNED_FOR_CORRECTION", version: { increment: 1 } } });
  await tx.employeeInvitationToken.updateMany({ where: { participant: { registrationId }, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  await appendAudit(tx, actor, { action: "APPROVAL_INVALIDATED", entityType: "CompanyEventRegistration", entityId: registrationId, eventId: registration.eventId, companyId: registration.companyId, metadata: { version: updated.version } });
  const key = `registration:${registrationId}:invalidated:${updated.version}`;
  await enqueueInvalidation(tx, key, { entityId: registrationId, eventId: registration.eventId, version: updated.version });
  if (registration.primaryLeader && !registration.primaryLeader.revokedAt) await recordNotification(tx, { recipientUserId: registration.primaryLeader.userId, registrationId, eventId: registration.eventId, type: "REGISTRATION_UPDATED", deduplicationKey: key, parameters: { updateKind: "APPROVAL_INVALIDATED" } });
}
