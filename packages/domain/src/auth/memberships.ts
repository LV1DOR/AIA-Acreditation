import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "./authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { recordNotification } from "../notifications/record.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";

const membershipInput = z.object({ membershipId:z.uuid(), expectedVersion:z.number().int().positive(), action:z.enum(["REVOKE","RESTORE"]), reason:z.string().trim().min(5).max(1000) }).strict();
export async function manageLeaderMembership(db:PrismaClient, context:ActorContext, raw:z.input<typeof membershipInput>) {
  const input=membershipInput.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context); requireAdmin(actor);
    const m=await tx.companyLeaderMembership.findUnique({where:{id:input.membershipId},include:{company:true,user:true}});
    if (!m || m.company.internalOrganisation || m.company.deactivatedAt || (input.action==="RESTORE" && (m.user.disabledAt || m.user.role!=="COMPANY_LEADER")) || m.version!==input.expectedVersion || Boolean(m.revokedAt)===(input.action==="REVOKE")) throw new DomainError("STALE_WRITE");
    const updated=await tx.companyLeaderMembership.update({where:{id:m.id},data:{revokedAt:input.action==="REVOKE"?new Date():null,version:{increment:1}}});
    if(input.action==="REVOKE") {
      await tx.companyEventRegistration.updateMany({where:{companyId:m.companyId,primaryLeaderMembershipId:m.id},data:{primaryLeaderMembershipId:null,version:{increment:1}}});
      // Invitations have email targets, not trusted user mappings. Invalidate all outstanding
      // invitations for this company; existing secondary memberships are left intact.
      await tx.leaderInvitation.updateMany({where:{companyId:m.companyId,usedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
    }
    await appendAudit(tx,actor,{action:input.action==="REVOKE"?"MEMBERSHIP_REVOKED":"MEMBERSHIP_RESTORED",entityType:"CompanyLeaderMembership",entityId:m.id,companyId:m.companyId,metadata:{version:updated.version,reason:input.reason}});
    const registrations=await tx.companyEventRegistration.findMany({where:{companyId:m.companyId}});
    for(const r of registrations) await recordNotification(tx,{eventId:r.eventId,registrationId:r.id,recipientUserId:m.userId,type:"REGISTRATION_UPDATED",parameters:{updateKind:input.action==="REVOKE"?"MEMBERSHIP_REVOKED":"MEMBERSHIP_RESTORED"},deduplicationKey:`membership:${m.id}:${updated.version}:${r.id}`});
    await enqueueInvalidation(tx,`membership:${m.id}:${updated.version}`,{entityId:m.id,version:updated.version});
    return updated;
  });
}
const primaryInput=z.object({registrationId:z.uuid(),membershipId:z.uuid(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
export async function assignPrimaryLeader(db:PrismaClient,context:ActorContext,raw:z.input<typeof primaryInput>) {
  const input=primaryInput.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);
    const r=await tx.companyEventRegistration.findUniqueOrThrow({where:{id:input.registrationId},include:{company:true}});
    const m=await tx.companyLeaderMembership.findFirst({where:{id:input.membershipId,companyId:r.companyId,revokedAt:null,user:{role:"COMPANY_LEADER",disabledAt:null}}});
    if(!m || r.company.internalOrganisation || r.company.deactivatedAt) throw new DomainError("INVALID_INPUT");
    if(!(await tx.companyEventRegistration.updateMany({where:{id:r.id,version:input.expectedVersion},data:{primaryLeaderMembershipId:m.id,version:{increment:1}}})).count) throw new DomainError("STALE_WRITE");
    await appendAudit(tx,actor,{action:"PRIMARY_LEADER_CHANGED",entityType:"CompanyEventRegistration",entityId:r.id,companyId:r.companyId,eventId:r.eventId,metadata:{version:input.expectedVersion+1,reason:input.reason}});
    await recordNotification(tx,{recipientUserId:m.userId,eventId:r.eventId,registrationId:r.id,type:"REGISTRATION_UPDATED",parameters:{updateKind:"PRIMARY_LEADER_CHANGED"},deduplicationKey:`primary:${r.id}:${input.expectedVersion+1}`});
    await enqueueInvalidation(tx,`primary:${r.id}:${input.expectedVersion+1}`,{entityId:r.id,eventId:r.eventId,version:input.expectedVersion+1});
  });
}
