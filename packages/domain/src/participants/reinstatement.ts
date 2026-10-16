import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
const inputSchema=z.object({participantId:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
export async function reinstateRemovedParticipant(db:PrismaClient,context:ActorContext,raw:z.input<typeof inputSchema>) {
  const input=inputSchema.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);
    const p=await tx.eventParticipant.findUniqueOrThrow({where:{id:input.participantId},include:{registration:{include:{company:true,event:true}}}});
    if(p.status!=="REMOVED" || p.version!==input.expectedVersion || p.registration.company.deactivatedAt || ["DRAFT","ARCHIVED"].includes(p.registration.event.status)) throw new DomainError("EDIT_LOCKED");
    const count=await tx.eventParticipant.count({where:{registrationId:p.registrationId,status:{notIn:["REMOVED","REPLACED"]}}});
    if(count>=p.registration.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    await invalidateEffectiveApproval(tx,actor,p.registrationId);
    if(!["DRAFT","RETURNED_FOR_CORRECTION"].includes((await tx.companyEventRegistration.findUniqueOrThrow({where:{id:p.registrationId}})).status)) throw new DomainError("EDIT_LOCKED");
    // Reinstatement is an explicit approved completion grant, never a restoration of approval.
    const grant=await tx.companyRequest.create({data:{registrationId:p.registrationId,targetParticipantId:p.id,createdByUserId:actor.userId,reviewedByUserId:actor.userId,reviewedAt:new Date(),status:"APPROVED",type:"EDIT_PERSON",payload:{type:"EDIT_PERSON",scope:"OTHER"},reason:input.reason,effectBaseVersion:p.version+1}});
    await tx.eventParticipant.update({where:{id:p.id},data:{status:"DRAFT",editRequestId:grant.id,version:{increment:1}}});
    await tx.employeeInvitationToken.updateMany({where:{participantId:p.id,usedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
    await appendAudit(tx,actor,{action:"PARTICIPANT_REINSTATED",entityType:"EventParticipant",entityId:p.id,eventId:p.eventId,companyId:p.registration.companyId,metadata:{reason:input.reason,version:p.version+1}});
  });
}
