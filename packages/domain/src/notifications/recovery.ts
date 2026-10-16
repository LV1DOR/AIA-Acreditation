import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@aia/database";
import { transaction, type Tx } from "../shared/transaction.ts";
import type { ActorContext } from "../shared/actor.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";

export async function reconcileExpiredDeliveryLeases(db:PrismaClient,now=new Date()) {
  return transaction(db,async tx=>{
    const expired=await tx.outboxMessage.findMany({where:{type:"AUTH_EMAIL",processedAt:null,terminalAt:null,createdAt:{lt:new Date(now.getTime()-300000)}},select:{id:true},take:100});
    if(expired.length){const ids=expired.map(r=>r.id);await tx.outboxMessage.updateMany({where:{id:{in:ids}},data:{terminalAt:now,payload:{},leaseOwner:null,leaseExpiresAt:null,lastFailureCode:"AUTH_CAPABILITY_EXPIRED_FINAL"}});await tx.emailDelivery.updateMany({where:{outboxMessageId:{in:ids}},data:{status:"EXPIRED",lastFailureCode:"AUTH_CAPABILITY_EXPIRED_FINAL"}});}
    const rows=await tx.outboxMessage.findMany({where:{processedAt:null,terminalAt:null,OR:[{type:{in:["AUTH_EMAIL","LEADER_INVITATION_EMAIL","BUSINESS_EMAIL"]},attempts:{gte:8}},{type:"DOMAIN_INVALIDATION",attempts:{gte:12}}],AND:[{OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:now}}]}]},take:100});
    for(const row of rows) {
      const changed=await tx.outboxMessage.updateMany({where:{id:row.id,processedAt:null,terminalAt:null,OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:now}}]},data:{terminalAt:now,leaseOwner:null,leaseExpiresAt:null,payload:{},lastFailureCode:"FINAL_LEASE_EXPIRED_UNCERTAIN"}});
      if(changed.count)await tx.emailDelivery.updateMany({where:{outboxMessageId:row.id},data:{status:"UNKNOWN",attempts:row.attempts,lastFailureCode:"FINAL_LEASE_EXPIRED_UNCERTAIN"}});
    }return rows.length;
  });
}
export async function claimDelivery(tx:Tx,types:string[],limit:number,owner:string,now:Date) {
  const where={type:{in:types},processedAt:null,terminalAt:null,attempts:{lt:limit},availableAt:{lte:now},OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:now}}]};
  const row=await tx.outboxMessage.findFirst({where,orderBy:[{availableAt:"asc" as const},{id:"asc" as const}]});
  if(!row)return null;
  const claimed=await tx.outboxMessage.updateMany({where:{...where,id:row.id},data:{leaseOwner:owner,leaseExpiresAt:new Date(now.getTime()+60000),attempts:{increment:1}}});return claimed.count?row:null;
}
export async function finishDeliveryFailure(db:PrismaClient,id:string,owner:string,attempts:number,limit:number,code="EMAIL_DELIVERY_FAILED",forceFinal=false) {
  const final=forceFinal || attempts>=limit,now=new Date();
  return transaction(db,async tx=>{
    const changed=await tx.outboxMessage.updateMany({where:{id,leaseOwner:owner},data:{leaseOwner:null,leaseExpiresAt:null,availableAt:new Date(now.getTime()+Math.min(300,2**attempts)*1000),lastFailureCode:final?`${code}_FINAL`:code,...(final?{terminalAt:now,payload:{}}:{})}});
    if(changed.count)await tx.emailDelivery.updateMany({where:{outboxMessageId:id},data:{status:final?"FAILED":"RETRYING",attempts,lastFailureCode:final?`${code}_FINAL`:code}});
    return changed.count;
  });
}
export async function deliveryRecoveryOverview(db:PrismaClient,context:ActorContext,cursor?:string) {
  requireAdmin(await resolveActor(db,context));
  const position=cursor&&z.uuid().safeParse(cursor).success&&await db.outboxMessage.count({where:{id:cursor}})?cursor:undefined;
  const rows=await db.outboxMessage.findMany({where:{OR:[{terminalAt:{not:null}},{processedAt:null,leaseExpiresAt:{lt:new Date()}}]},orderBy:[{createdAt:"desc"},{id:"desc"}],take:21,...(position?{cursor:{id:position},skip:1}:{}),select:{id:true,type:true,createdAt:true,attempts:true,recoveries:true,terminalAt:true,lastFailureCode:true,registrationId:true,eventId:true,emailDelivery:{select:{status:true}}}});
  const ids=rows.flatMap(r=>r.registrationId?[r.registrationId]:[]),registrations=await db.companyEventRegistration.findMany({where:{id:{in:ids}},select:{id:true,company:{select:{name:true}},event:{select:{name:true}}}});return rows.map(r=>({...r,context:registrations.find(x=>x.id===r.registrationId)}));
}
const recipe=z.object({recipientUserId:z.uuid(),registrationId:z.uuid()}).strict();
export async function recoverDelivery(db:PrismaClient,context:ActorContext,messageId:string,reasonReference:string) {
  z.uuid().parse(messageId);z.string().trim().min(5).max(200).parse(reasonReference);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);const old=await tx.outboxMessage.findUniqueOrThrow({where:{id:messageId}});
    if(!old.terminalAt || old.processedAt || ["AUTH_EMAIL","LEADER_INVITATION_EMAIL"].includes(old.type))throw new DomainError("RECOVERY_NOT_ALLOWED");
    let payload:Prisma.InputJsonValue;const type=old.type;
    if(old.type==="DOMAIN_INVALIDATION")payload={entityId:old.id,eventId:old.eventId??undefined,version:1};
    else if(old.type==="BUSINESS_EMAIL") {
      const parsed=recipe.safeParse(old.recoveryPayload);if(!parsed.success)throw new DomainError("RECOVERY_NOT_ALLOWED");
      const r=await tx.companyEventRegistration.findUnique({where:{id:parsed.data.registrationId},include:{company:true,event:true}}),user=await tx.user.findUnique({where:{id:parsed.data.recipientUserId}});
      if(!r || r.erasedAt || r.company.deactivatedAt || !user || user.disabledAt)throw new DomainError("RECOVERY_NOT_ALLOWED");
      if(user.role!=="ADMIN" && !await tx.companyLeaderMembership.count({where:{userId:user.id,companyId:r.companyId,revokedAt:null}}))throw new DomainError("RECOVERY_NOT_ALLOWED");
      if(await tx.privacyErasureJob.count({where:{registrationId:r.id,status:{not:"CANCELLED"}}}))throw new DomainError("RECOVERY_NOT_ALLOWED");
      // Reissue a fresh, neutral portal update instead of an old approval claim or deadline.
      payload={recipientUserId:user.id,template:"STATUS_UPDATE",companyName:r.company.name,eventName:r.event.name,path:"/portal"};
    }else throw new DomainError("RECOVERY_NOT_ALLOWED");
    const id=randomUUID();await tx.outboxMessage.create({data:{id,type,deduplicationKey:`recovery:${old.id}:${old.recoveries+1}`,payload,registrationId:old.registrationId,eventId:old.eventId,recoveryPayload:old.recoveryPayload??{}}});
    if(type==="BUSINESS_EMAIL")await tx.emailDelivery.create({data:{outboxMessageId:id}});
    await tx.outboxMessage.update({where:{id:old.id},data:{recoveries:{increment:1}}});
    await tx.auditEvent.create({data:{actorType:"ADMIN",actorUserId:actor.userId,action:"DELIVERY_RECOVERY_REISSUED",entityType:"OutboxMessage",entityId:old.id,eventId:old.eventId,correlationId:actor.correlationId,metadata:{}}});return {id};
  });
}
export async function businessDeliveryContext(tx:Tx,p:{recipientUserId:string;companyName:string;eventName:string;registrationId?:string}) {
  const rows=await tx.companyEventRegistration.findMany({where:p.registrationId?{id:p.registrationId}:{company:{name:p.companyName},event:{name:p.eventName}},take:2,select:{id:true,eventId:true}});
  if(rows.length!==1)return {};
  const row=rows[0]!;return {registrationId:row.id,eventId:row.eventId,recoveryPayload:{recipientUserId:p.recipientUserId,registrationId:row.id}};
}
export async function authDeliveryStillValid(db:PrismaClient,message:{type:string;deduplicationKey:string;createdAt:Date},now=new Date()) {
  if(message.type==="AUTH_EMAIL")return now.getTime()-message.createdAt.getTime()<300000;
  const invitationId=message.deduplicationKey.replace(/^leader-invitation:/,"");if(!z.uuid().safeParse(invitationId).success)return false;
  return Boolean(await db.leaderInvitation.findFirst({where:{id:invitationId,usedAt:null,revokedAt:null,expiresAt:{gt:now},registration:{company:{deactivatedAt:null}}}}));
}
