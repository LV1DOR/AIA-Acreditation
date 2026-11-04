import {randomUUID} from "node:crypto";
import {Prisma,type PrismaClient} from "@aia/database";
import {syntheticMode} from "@aia/config";
import {transaction} from "../shared/transaction.ts";

// Scheduling frequency is operational, not a retention period. Only existing,
// approved policies/cutoffs authorise data changes. No guessed duration exists.
export const COMMUNICATION_CLEANUP_INTERVAL_MS=60*60*1000;
const batchSize=100;
const terminal=(now:Date)=>({
  AND:[{OR:[{processedAt:{not:null}},{terminalAt:{not:null}}]},
       {OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:now}}]}],
});
const hasMetadata:Prisma.OutboxMessageWhereInput={OR:[
  {NOT:{payload:{equals:{}}}},
  {AND:[{recoveryPayload:{not:Prisma.AnyNull}},{NOT:{recoveryPayload:{equals:{}}}}]},
  {emailDelivery:{is:{OR:[{recipientHash:{not:null}},{providerMessageId:{not:null}}]}}},
]};
async function clearMessages(tx:Prisma.TransactionClient,where:Prisma.OutboxMessageWhereInput,now:Date){
  const rows=await tx.outboxMessage.findMany({where:{AND:[where,terminal(now),hasMetadata]},select:{id:true},take:batchSize,orderBy:[{createdAt:"asc"},{id:"asc"}]});
  if(!rows.length)return 0;
  const ids=rows.map(r=>r.id);
  await tx.emailDelivery.updateMany({where:{outboxMessageId:{in:ids}},data:{recipientHash:null,providerMessageId:null,lastFailureCode:"RETENTION_EXPIRED"}});
  await tx.outboxMessage.updateMany({where:{id:{in:ids}},data:{payload:{},recoveryPayload:{},processedAt:now,leaseOwner:null,leaseExpiresAt:null,lastFailureCode:"RETENTION_EXPIRED"}});
  return ids.length;
}

export async function cleanupExpiredCommunicationMetadata(db:PrismaClient,now=new Date()){
  const result={notifications:0,messages:0,authMessages:0,unlinkedEmails:0};
  if((await db.operationalHeartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount)return result;
  const synthetic=syntheticMode();
  // Select only the latest matching policy for each event. Existing holds remain
  // enforced in the background even though clients no longer manage them.
  const due=await db.$queryRaw<{eventId:string}[]>`
    SELECT p."eventId" FROM "EventRetentionPolicy" p
    WHERE p.id=(SELECT q.id FROM "EventRetentionPolicy" q WHERE q."eventId"=p."eventId" AND q.synthetic=${synthetic} ORDER BY q."createdAt" DESC,q.id DESC LIMIT 1)
      AND p.synthetic=${synthetic} AND p."communicationsEraseAfter"<=${now}
      AND NOT EXISTS(SELECT 1 FROM "EventPrivacyHold" h WHERE h."eventId"=p."eventId" AND h.active)
      AND (EXISTS(SELECT 1 FROM "Notification" n WHERE n."eventId"=p."eventId" AND n."createdAt"<p."communicationsEraseAfter")
        OR EXISTS(SELECT 1 FROM "OutboxMessage" m LEFT JOIN "CompanyEventRegistration" r ON r.id=m."registrationId"
          LEFT JOIN "EmailDelivery" e ON e."outboxMessageId"=m.id
          WHERE (m."eventId"=p."eventId" OR r."eventId"=p."eventId") AND m.type IN ('BUSINESS_EMAIL','LEADER_INVITATION_EMAIL','DOMAIN_INVALIDATION')
            AND m."createdAt"<p."communicationsEraseAfter" AND (m."processedAt" IS NOT NULL OR m."terminalAt" IS NOT NULL)
            AND (m."leaseExpiresAt" IS NULL OR m."leaseExpiresAt"<${now})
            AND (m.payload<>'{}'::jsonb OR COALESCE(NULLIF(m."recoveryPayload",'null'::jsonb),'{}'::jsonb)<>'{}'::jsonb OR e."recipientHash" IS NOT NULL OR e."providerMessageId" IS NOT NULL)))
    ORDER BY p."communicationsEraseAfter",p.id LIMIT 10`;
  for(const item of due){
    const cleared=await transaction(db,async tx=>{
      if((await tx.operationalHeartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount)return {notifications:0,messages:0};
      const policy=await tx.eventRetentionPolicy.findFirst({where:{eventId:item.eventId,synthetic},orderBy:[{createdAt:"desc"},{id:"desc"}]});
      if(!policy||policy.communicationsEraseAfter>now||await tx.eventPrivacyHold.count({where:{eventId:item.eventId,active:true}}))return {notifications:0,messages:0};
      const cutoff=policy.communicationsEraseAfter;
      const registrations=await tx.companyEventRegistration.findMany({where:{eventId:item.eventId},select:{id:true}});
      const scope={OR:[{eventId:item.eventId},{registrationId:{in:registrations.map(r=>r.id)}}]};
      const notifications=await tx.notification.findMany({where:{eventId:item.eventId,createdAt:{lt:cutoff}},select:{id:true},take:batchSize,orderBy:[{createdAt:"asc"},{id:"asc"}]});
      if(notifications.length)await tx.notification.deleteMany({where:{id:{in:notifications.map(n=>n.id)}}});
      const messages=await clearMessages(tx,{...scope,createdAt:{lt:cutoff},type:{in:["BUSINESS_EMAIL","LEADER_INVITATION_EMAIL","DOMAIN_INVALIDATION"]}},now);
      if(notifications.length||messages)await tx.auditEvent.create({data:{actorType:"SYSTEM",action:"COMMUNICATIONS_PURGED",entityType:"PrivacyOperation",entityId:randomUUID(),eventId:item.eventId,correlationId:randomUUID(),metadata:{policyId:policy.id,notifications:notifications.length,messages}}});
      return {notifications:notifications.length,messages};
    });
    result.notifications+=cleared.notifications;result.messages+=cleared.messages;
  }
  const cutoff=new Date(process.env.AUTH_METADATA_ERASE_BEFORE??""),reference=process.env.AUTH_METADATA_POLICY_REFERENCE?.trim();
  if(reference&&reference.length>=5&&Number.isFinite(cutoff.getTime())&&cutoff<=now){
    result.authMessages=await transaction(db,async tx=>{
      if((await tx.operationalHeartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount||await tx.eventPrivacyHold.count({where:{active:true}}))return 0;
      const count=await clearMessages(tx,{type:"AUTH_EMAIL",createdAt:{lt:cutoff}},now);
      if(count)await tx.auditEvent.create({data:{actorType:"SYSTEM",action:"AUTH_METADATA_PURGED",entityType:"PrivacyOperation",entityId:randomUUID(),correlationId:randomUUID(),metadata:{policyReference:reference,count}}});
      return count;
    });
  }
  // Standalone verified provider messages have no event/registration policy.
  // Only an explicit approved cutoff may authorise their routine redaction.
  const monitorCutoff=new Date(process.env.EMAIL_MONITOR_ERASE_BEFORE??""),monitorReference=process.env.EMAIL_MONITOR_POLICY_REFERENCE?.trim();
  if(monitorReference&&monitorReference.length>=5&&Number.isFinite(monitorCutoff.getTime())&&monitorCutoff<=now){
    result.unlinkedEmails=await transaction(db,async tx=>{
      if((await tx.operationalHeartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount||await tx.eventPrivacyHold.count({where:{active:true}}))return 0;
      const rows=await tx.emailDelivery.findMany({where:{outboxMessageId:null,erasedAt:null,createdAt:{lt:monitorCutoff}},select:{id:true},take:batchSize,orderBy:[{createdAt:"asc"},{id:"asc"}]});
      if(rows.length){
        await tx.emailDelivery.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:{recipientHash:null,providerMessageId:null,lastFailureCode:"RETENTION_EXPIRED"}});
        await tx.auditEvent.create({data:{actorType:"SYSTEM",action:"EMAIL_MONITOR_METADATA_PURGED",entityType:"PrivacyOperation",entityId:randomUUID(),correlationId:randomUUID(),metadata:{policyReference:monitorReference,count:rows.length}}});
      }
      return rows.length;
    });
  }
  return result;
}
