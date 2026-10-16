import {syntheticMode} from "@aia/config";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { appendAudit } from "../audit/append.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";

const idInput = z.object({ id: z.uuid() }).strict();

export async function permanentlyDeleteParticipant(db: PrismaClient, context: ActorContext, raw: z.input<typeof idInput>) {
  const input = idInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const participant = await tx.eventParticipant.findUnique({
      where: { id: input.id },
      include: { registration: { select: { companyId: true, status: true } }, submissionPhotoAdjustments: { select: { photoObjectKey: true } } },
    });
    if (!participant) throw new DomainError("NOT_FOUND");
    // Deleting historical bytes or participant reviews would destroy review evidence.
    if (["APPROVED", "AIA_REVIEW"].includes(participant.registration.status) || await tx.companySubmission.count({ where: { registrationId: participant.registrationId } })) throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    if(!syntheticMode() && (participant.fullName||participant.photoObjectKey||participant.documentNumberCiphertext||participant.mobileE164))throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    const photoObjectKeys = [participant.photoObjectKey, ...participant.submissionPhotoAdjustments.map(item => item.photoObjectKey)].filter((value): value is string => Boolean(value));
    for(const objectKey of photoObjectKeys)await tx.storageDeletion.upsert({where:{bucket_objectKey:{bucket:process.env.MINIO_PHOTOS_BUCKET??"aia-phase1-synthetic",objectKey}},create:{bucket:process.env.MINIO_PHOTOS_BUCKET??"aia-phase1-synthetic",objectKey},update:{status:"PENDING",availableAt:new Date()}});
    if(await tx.privacyAcknowledgement.count({where:{participantId:participant.id}}))throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    await appendAudit(tx, actor, { action: "PARTICIPANT_DELETED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
    await tx.companyRequest.updateMany({ where: { targetParticipantId: participant.id }, data: { targetParticipantId: null } });
    await tx.submissionParticipantReview.deleteMany({ where: { participantId: participant.id } });
    await tx.submissionPhotoAdjustment.deleteMany({ where: { participantId: participant.id } });
    await tx.participantZoneRequest.deleteMany({where:{participantId:participant.id}});
    await tx.participantWorkDay.deleteMany({ where: { participantId: participant.id } });
    await tx.employeeInvitationToken.deleteMany({ where: { participantId: participant.id } });
    await tx.eventParticipant.delete({ where: { id: participant.id } });
    return { photoObjectKeys };
  });
}

export async function permanentlyDeleteCompany(db: PrismaClient, context: ActorContext, raw: z.input<typeof idInput>) {
  const input = idInput.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const company = await tx.company.findUnique({ where: { id: input.id } });
    if (!company) throw new DomainError("NOT_FOUND");
    const approvedRegistration = await tx.companyEventRegistration.findFirst({
      where: { companyId: company.id, status: "APPROVED" },
      select: { id: true },
    });
    if (approvedRegistration) throw new DomainError("APPROVED_COMPANY_DELETE_FORBIDDEN");
    if (await tx.companySubmission.count({ where: { registration: { companyId: company.id } } })) throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    const registrations = await tx.companyEventRegistration.findMany({ where: { companyId: company.id }, select: { id: true } });
    const registrationIds = registrations.map(item => item.id);
    const participants = registrationIds.length ? await tx.eventParticipant.findMany({
      where: { registrationId: { in: registrationIds } },
      select: { id: true, fullName:true, documentNumberCiphertext:true,mobileE164:true,photoObjectKey: true, submissionPhotoAdjustments: { select: { photoObjectKey: true } } },
    }) : [];
    const participantIds = participants.map(item => item.id);
    const submissions = registrationIds.length ? await tx.companySubmission.findMany({ where: { registrationId: { in: registrationIds } }, select: { id: true } }) : [];
    const submissionIds = submissions.map(item => item.id);
    const photoObjectKeys = participants.flatMap(item => [item.photoObjectKey, ...item.submissionPhotoAdjustments.map(photo => photo.photoObjectKey)]).filter((value): value is string => Boolean(value));

    if(!syntheticMode() && participants.some(p=>p.photoObjectKey||p.fullName||p.documentNumberCiphertext||p.mobileE164))throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    if(await tx.privacyAcknowledgement.count({where:{registrationId:{in:registrationIds}}}))throw new DomainError("SNAPSHOT_WORKFLOW_REQUIRED");
    for(const objectKey of photoObjectKeys)await tx.storageDeletion.upsert({where:{bucket_objectKey:{bucket:process.env.MINIO_PHOTOS_BUCKET??"aia-phase1-synthetic",objectKey}},create:{bucket:process.env.MINIO_PHOTOS_BUCKET??"aia-phase1-synthetic",objectKey},update:{status:"PENDING",availableAt:new Date()}});
    await appendAudit(tx, actor, { action: "COMPANY_DELETED", entityType: "Company", entityId: company.id, companyId: company.id });
    if (participantIds.length) {
      await tx.eventParticipant.updateMany({ where: { id: { in: participantIds } }, data: { replacementRequestId: null, editRequestId:null } });
      await tx.submissionParticipantReview.deleteMany({ where: { participantId: { in: participantIds } } });
      await tx.submissionPhotoAdjustment.deleteMany({ where: { participantId: { in: participantIds } } });
    }
    if (registrationIds.length) {
      await tx.participantZoneRequest.deleteMany({where:{participant:{registrationId:{in:registrationIds}}}});
      await tx.internalImportBatch.deleteMany({where:{registrationId:{in:registrationIds}}});
      await tx.companyRequest.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.participantWorkDay.deleteMany({ where: { participant: { registrationId: { in: registrationIds } } } });
      await tx.employeeInvitationToken.deleteMany({ where: { participant: { registrationId: { in: registrationIds } } } });
      await tx.eventParticipant.deleteMany({ where: { registrationId: { in: registrationIds } } });
      if (submissionIds.length) await tx.companySubmissionReview.deleteMany({ where: { submissionId: { in: submissionIds } } });
      await tx.companySubmission.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.leaderInvitation.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.companyZoneRequest.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.vehiclePassRequest.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.notification.deleteMany({ where: { registrationId: { in: registrationIds } } });
      await tx.companyEventRegistration.deleteMany({ where: { id: { in: registrationIds } } });
    }
    await tx.companyLeaderMembership.deleteMany({ where: { companyId: company.id } });
    await tx.company.delete({ where: { id: company.id } });
    return { photoObjectKeys };
  });
}
