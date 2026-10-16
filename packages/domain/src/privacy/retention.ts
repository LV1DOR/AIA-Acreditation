import {syntheticMode} from "@aia/config";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { resolveActor, requireAdmin } from "../auth/authorization.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
import { decryptSubmissionSnapshot } from "../submissions/snapshot-crypto.ts";
import { DomainError } from "../shared/errors.ts";

type Client=PrismaClient|Tx;
const reference=z.string().trim().min(5).max(200);
const policyInput=z.object({eventId:z.uuid(),recordsEraseAfter:z.date(),evidenceEraseAfter:z.date(),communicationsEraseAfter:z.date(),backupsEraseAfter:z.date(),approvalReference:reference,approved:z.literal(true),automaticPurge:z.literal(false)}).strict().refine(p=>p.evidenceEraseAfter>=p.recordsEraseAfter);
export async function approveEventRetentionPolicy(db:PrismaClient,context:ActorContext,raw:z.input<typeof policyInput>) {
  const p=policyInput.parse(raw);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);await tx.event.findUniqueOrThrow({where:{id:p.eventId}});
    const row=await tx.eventRetentionPolicy.create({data:{eventId:p.eventId,recordsEraseAfter:p.recordsEraseAfter,evidenceEraseAfter:p.evidenceEraseAfter,communicationsEraseAfter:p.communicationsEraseAfter,backupsEraseAfter:p.backupsEraseAfter,approvalReference:p.approvalReference,approvedByUserId:actor.userId,synthetic:syntheticMode()}});
    await privacyAudit(tx,actor,"RETENTION_POLICY_APPROVED",row.id,p.eventId);return row;
  });
}
async function privacyAudit(tx:Client,actor:Awaited<ReturnType<typeof resolveActor>>,action:string,id:string,eventId:string) {
  await tx.auditEvent.create({data:{actorType:actor.role,actorUserId:actor.userId,action,entityType:"PrivacyOperation",entityId:id,eventId,correlationId:actor.correlationId,metadata:{}}});
}
export async function setEventPrivacyHold(db:PrismaClient,context:ActorContext,eventId:string,active:boolean,approvalReference:string) {
  reference.parse(approvalReference);z.uuid().parse(eventId);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);await tx.event.findUniqueOrThrow({where:{id:eventId}});
    await tx.eventPrivacyHold.upsert({where:{eventId},create:{eventId,active,reference:approvalReference,updatedByUserId:actor.userId},update:{active,reference:approvalReference,updatedByUserId:actor.userId}});
    await privacyAudit(tx,actor,active?"PRIVACY_HOLD_SET":"PRIVACY_HOLD_RELEASED",eventId,eventId);
  });
}
async function policyFor(db:Client,eventId:string) {return db.eventRetentionPolicy.findFirst({where:{eventId,...(!syntheticMode()?{synthetic:false}:{})},orderBy:[{createdAt:"desc"},{id:"desc"}]});}
const scopeHash=(dataHash:string,policyId:string,stage:string)=>createHash('sha256').update(JSON.stringify([dataHash,policyId,stage])).digest('hex');
async function inventory(db:Client,registrationId:string,encryptionKey:string) {
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:registrationId},include:{participants:{select:{id:true,version:true,photoObjectKey:true}},submissions:{select:{id:true,snapshot:true,contentHash:true}},company:true}});
  const ids=r.participants.map(p=>p.id);
  const [uploads,adjustments,acks,reviews,notifications,deliveries]=await Promise.all([
    db.photoUpload.findMany({where:{participantId:{in:ids}}}),db.submissionPhotoAdjustment.findMany({where:{participantId:{in:ids}}}),
    db.privacyAcknowledgement.count({where:{registrationId}}),db.submissionParticipantReview.count({where:{participantId:{in:ids}}}),
    db.notification.count({where:{registrationId}}),db.outboxMessage.count({where:{registrationId}}),
  ]);
  const keys=new Set(r.participants.flatMap(p=>p.photoObjectKey?[p.photoObjectKey]:[]));
  for(const upload of uploads) if(upload.status!=="CLEANED") keys.add(upload.objectKey);
  for(const a of adjustments) if(a.photoObjectKey && a.photoObjectKey!=="[erased]")keys.add(a.photoObjectKey);
  for(const s of r.submissions) {
    const snapshot=decryptSubmissionSnapshot(s.snapshot,encryptionKey,s.id) as {participants?:{photoObjectKey?:string|null}[]};
    for(const p of snapshot.participants??[])if(p.photoObjectKey)keys.add(p.photoObjectKey);
  }
  const counts={participants:ids.length,snapshots:r.submissions.length,participantReviews:reviews,acknowledgements:acks,photos:keys.size,notifications,emailJobs:deliveries};
  const objectKeys=[...keys].sort();
  const previewHash=createHash("sha256").update(JSON.stringify({id:r.id,version:r.version,companyVersion:r.company.version,participants:r.participants.sort((a,b)=>a.id.localeCompare(b.id)),submissions:r.submissions.map(s=>({id:s.id,hash:s.contentHash})).sort((a,b)=>a.id.localeCompare(b.id)),counts,objectKeys})).digest("hex");
  return {r,counts,objectKeys,previewHash};
}
export async function previewPrivacyErasure(db:PrismaClient,context:ActorContext,registrationId:string,key:string,stage:"PERSONAL_DATA"|"ALL_EVIDENCE"="PERSONAL_DATA",now=new Date()) {
  requireAdmin(await resolveActor(db,context));z.uuid().parse(registrationId);
  const i=await inventory(db,registrationId,key),policy=await policyFor(db,i.r.eventId),hold=await db.eventPrivacyHold.findUnique({where:{eventId:i.r.eventId}});
  const blockers=[];
  if(!policy)blockers.push("APPROVED_POLICY_REQUIRED");
  if(hold?.active)blockers.push("LEGAL_HOLD");
  if(policy && now<(stage==="ALL_EVIDENCE"?policy.evidenceEraseAfter:policy.recordsEraseAfter))blockers.push("RETENTION_DATE_NOT_REACHED");
  if(stage==="ALL_EVIDENCE" && !i.r.erasedAt)blockers.push("PERSONAL_ERASURE_FIRST");
  const outstanding=await db.privacyErasureJob.count({where:{registrationId,status:{notIn:["COMPLETE","CANCELLED"]}}});if(outstanding)blockers.push("ERASURE_ALREADY_PENDING");
  const backups=await db.backupRun.count({where:{status:{not:"DELETED"},deletedAt:null}});
  return {registrationId,eventId:i.r.eventId,registrationVersion:i.r.version,companyName:i.r.company.name,stage,policyId:policy?.id,counts:i.counts,previewHash:scopeHash(i.previewHash,policy?.id??"",stage),blockers,accessibleBackups:backups};
}
const erasureInput=z.object({registrationId:z.uuid(),expectedVersion:z.number().int().positive(),previewHash:z.string().regex(/^[a-f0-9]{64}$/),stage:z.enum(["PERSONAL_DATA","ALL_EVIDENCE"]).default("PERSONAL_DATA"),authorisationReference:reference,confirmed:z.literal(true)}).strict();
export async function requestPrivacyErasure(db:PrismaClient,context:ActorContext,raw:z.input<typeof erasureInput>,key:string,bucket:string) {
  const p=erasureInput.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);const i=await inventory(tx,p.registrationId,key),policy=await policyFor(tx,i.r.eventId),now=new Date();
    if(!policy || await tx.eventPrivacyHold.count({where:{eventId:i.r.eventId,active:true}}) || now<(p.stage==="ALL_EVIDENCE"?policy.evidenceEraseAfter:policy.recordsEraseAfter) || (p.stage==="ALL_EVIDENCE" && !i.r.erasedAt)) throw new DomainError("ERASURE_POLICY_REQUIRED");
    if(i.r.version!==p.expectedVersion || scopeHash(i.previewHash,policy.id,p.stage)!==p.previewHash) throw new DomainError("STALE_WRITE");
    if(await tx.privacyErasureJob.count({where:{registrationId:p.registrationId,status:{notIn:["COMPLETE","CANCELLED"]}}})) throw new DomainError("ERASURE_BLOCKED");
    await invalidateEffectiveApproval(tx,actor,i.r.id);
    // Freeze the scope before external work. Never indicate completion after this commit alone.
    const r=p.stage==="ALL_EVIDENCE"?i.r:await tx.companyEventRegistration.update({where:{id:i.r.id},data:{status:"REJECTED",version:{increment:1}}});
    const job=await tx.privacyErasureJob.create({data:{registrationId:r.id,eventId:r.eventId,policyId:policy.id,stage:p.stage,requestedByUserId:actor.userId,authorisationReference:p.authorisationReference,registrationVersion:r.version,previewHash:p.previewHash,synthetic:syntheticMode()}});
    for(const objectKey of i.objectKeys) await tx.storageDeletion.upsert({where:{bucket_objectKey:{bucket,objectKey}},create:{jobId:job.id,bucket,objectKey,eventId:r.eventId,policyId:policy.id,authorisationReference:p.authorisationReference},update:{jobId:job.id,status:"PENDING",availableAt:now,verifiedAt:null}});
    await privacyAudit(tx,actor,"PRIVACY_ERASURE_REQUESTED",job.id,r.eventId);
    return {id:job.id,status:job.status};
  });
}
// This client must authenticate using the separately provisioned executor role.
export async function executePrivacyDatabaseErasure(executor:PrismaClient,jobId:string) {
  z.uuid().parse(jobId);
  await executor.$queryRaw`SELECT public.execute_privacy_erasure(${jobId}::uuid)::text`;
}
export async function reauthorisePendingPrivacyErasure(db:PrismaClient,context:ActorContext,jobId:string,authorisationReference:string) {
  reference.parse(authorisationReference);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);const job=await tx.privacyErasureJob.findUniqueOrThrow({where:{id:z.uuid().parse(jobId)}}),policy=await policyFor(tx,job.eventId);
    if(job.databaseErasedAt || job.status!=="QUEUED" || !policy || await tx.eventPrivacyHold.count({where:{eventId:job.eventId,active:true}}) || new Date()<(job.stage==="ALL_EVIDENCE"?policy.evidenceEraseAfter:policy.recordsEraseAfter))throw new DomainError("ERASURE_BLOCKED");
    await tx.privacyErasureJob.update({where:{id:jobId},data:{requestedByUserId:actor.userId,policyId:policy.id,authorisationReference,lastFailureCode:null}});
    await tx.auditEvent.create({data:{actorType:"ADMIN",actorUserId:actor.userId,action:"ERASURE_REAUTHORISED",entityType:"PrivacyErasureJob",entityId:jobId,eventId:job.eventId,correlationId:actor.correlationId,metadata:{previousReference:job.authorisationReference,reference:authorisationReference}}});
  });
}
export async function requestPrivacyEvidenceExpiry(db:PrismaClient,context:ActorContext,jobId:string,authorisationReference:string) {
  reference.parse(authorisationReference);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);const job=await tx.privacyErasureJob.findUniqueOrThrow({where:{id:z.uuid().parse(jobId)}}),policy=await policyFor(tx,job.eventId);
    if(await tx.privacyErasureJob.count({where:{registrationId:job.registrationId,status:{notIn:["COMPLETE","CANCELLED"]}}}))throw new DomainError("ERASURE_BLOCKED");
    if(job.status!=="COMPLETE" || !policy || policy.evidenceEraseAfter>new Date() || await tx.companyEventRegistration.count({where:{id:job.registrationId}}) || await tx.eventPrivacyHold.count({where:{eventId:job.eventId,active:true}}))throw new DomainError("ERASURE_BLOCKED");
    await tx.privacyErasureJob.update({where:{id:jobId},data:{evidencePurgeRequestedAt:new Date(),evidencePurgeRequestedByUserId:actor.userId,evidencePurgeReference:authorisationReference}});await privacyAudit(tx,actor,"PRIVACY_EVIDENCE_EXPIRY_REQUESTED",jobId,job.eventId);
  });
}
export async function executePrivacyEvidenceExpiry(executor:PrismaClient,jobId:string) {z.uuid().parse(jobId);await executor.$queryRaw`SELECT public.purge_privacy_operation_evidence(${jobId}::uuid)::text`;}
export async function cleanupNextStorageDeletion(db:PrismaClient,eraseAndVerify:(bucket:string,key:string)=>Promise<void>,now=new Date(),jobId?:string) {
  const owner=randomUUID();
  const row=await transaction(db,async tx=>{
    const where={...(jobId?{jobId}:{}),AND:[{OR:[{jobId:null},{job:{databaseErasedAt:{not:null}}}]}],status:{in:["PENDING","RETRYING","DELETING"]},availableAt:{lte:now},OR:[{leaseExpiresAt:null},{leaseExpiresAt:{lt:now}}]};
    const item=await tx.storageDeletion.findFirst({where,orderBy:{createdAt:"asc"}});if(!item)return null;
    if(item.eventId && await tx.eventPrivacyHold.count({where:{eventId:item.eventId,active:true}}))return null;
    if(item.jobId && !await tx.privacyErasureJob.count({where:{id:item.jobId,databaseErasedAt:{not:null}}}))return null;
    await tx.storageDeletion.update({where:{id:item.id},data:{status:"DELETING",leaseOwner:owner,leaseExpiresAt:new Date(now.getTime()+120000),attempts:{increment:1}}});return item;
  });if(!row)return "IDLE";
  try{await eraseAndVerify(row.bucket,row.objectKey);await db.storageDeletion.updateMany({where:{id:row.id,leaseOwner:owner},data:{status:"VERIFIED",verifiedAt:new Date(),lastFailureCode:null,leaseOwner:null,leaseExpiresAt:null}});return "VERIFIED";}
  catch{await db.storageDeletion.updateMany({where:{id:row.id,leaseOwner:owner},data:{status:"RETRYING",lastFailureCode:"STORAGE_ERASURE_FAILED",availableAt:new Date(now.getTime()+Math.min(3600,2**Math.min(row.attempts+1,12))*1000),leaseOwner:null,leaseExpiresAt:null}});return "RETRY";}
}
export async function reconcilePrivacyErasure(db:PrismaClient,jobId:string) {
  const job=await db.privacyErasureJob.findUniqueOrThrow({where:{id:jobId}});if(!job.databaseErasedAt || job.status==="COMPLETE")return job.status;
  const pending=await db.storageDeletion.count({where:{jobId,status:{not:"VERIFIED"}}});
  // A date alone is not evidence that a backup has been deleted.
  const backups=await db.backupRun.count({where:{createdAt:{lte:job.databaseErasedAt},status:{not:"DELETED"},deletedAt:null}});
  const status=pending?"STORAGE_PENDING":backups || !job.externalCopiesReference?"COPIES_PENDING":"COMPLETE";
  await db.privacyErasureJob.update({where:{id:jobId},data:{status,...(status==="COMPLETE"?{completedAt:new Date(),lastFailureCode:null}:{})}});return status;
}
export async function attestExternalErasureCopies(db:PrismaClient,context:ActorContext,jobId:string,verificationReference:string) {
  z.uuid().parse(jobId);reference.parse(verificationReference);
  await transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);const j=await tx.privacyErasureJob.findUniqueOrThrow({where:{id:jobId}});if(!j.databaseErasedAt)throw new DomainError("ERASURE_BLOCKED");
    await tx.privacyErasureJob.update({where:{id:jobId},data:{externalCopiesReference:verificationReference,externalCopiesVerifiedByUserId:actor.userId}});await privacyAudit(tx,actor,"EXTERNAL_ERASURE_ATTESTED",jobId,j.eventId);
  });return reconcilePrivacyErasure(db,jobId);
}
export async function privacyOperationsOverview(db:PrismaClient,context:ActorContext,eventId:string) {
  requireAdmin(await resolveActor(db,context));z.uuid().parse(eventId);
  const [policy,hold,notices,jobs,registrations]=await Promise.all([policyFor(db,eventId),db.eventPrivacyHold.findUnique({where:{eventId}}),db.privacyNotice.findMany({where:{eventId},orderBy:{createdAt:"desc"},take:20}),db.privacyErasureJob.findMany({where:{eventId},orderBy:{createdAt:"desc"},take:50,include:{objects:{select:{status:true,lastFailureCode:true,attempts:true}}}}),db.companyEventRegistration.findMany({where:{eventId},select:{id:true,version:true,erasedAt:true,company:{select:{name:true}}},orderBy:{company:{name:"asc"}}})]);
  return {policy,hold,notices,jobs,registrations};
}
export async function purgeEventCommunications(db:PrismaClient,context:ActorContext,eventId:string,approvalReference:string,now=new Date()) {
  reference.parse(approvalReference);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);const policy=await policyFor(tx,eventId);
    if(!policy || policy.communicationsEraseAfter>now || await tx.eventPrivacyHold.count({where:{eventId,active:true}}))throw new DomainError("ERASURE_POLICY_REQUIRED");
    const registrations=await tx.companyEventRegistration.findMany({where:{eventId},select:{id:true}}),ids=registrations.map(r=>r.id);
    await tx.notification.deleteMany({where:{eventId}});
    await tx.outboxMessage.updateMany({where:{OR:[{eventId},{registrationId:{in:ids}}]},data:{payload:{},recoveryPayload:{},processedAt:now,terminalAt:now,leaseOwner:null,leaseExpiresAt:null,lastFailureCode:"RETENTION_EXPIRED"}});
    await tx.emailDelivery.updateMany({where:{outboxMessage:{OR:[{eventId},{registrationId:{in:ids}}]}},data:{recipientHash:null,providerMessageId:null,lastFailureCode:"RETENTION_EXPIRED"}});
    await privacyAudit(tx,actor,"COMMUNICATIONS_PURGED",eventId,eventId);
  });
}
export async function purgeApprovedAuthenticationMetadata(db:PrismaClient,context:ActorContext,operationReference:string,now=new Date()) {
  reference.parse(operationReference);const cutoff=new Date(process.env.AUTH_METADATA_ERASE_BEFORE??""),policyReference=process.env.AUTH_METADATA_POLICY_REFERENCE;
  if(!policyReference || policyReference.length<5 || !Number.isFinite(cutoff.getTime()) || cutoff>now)throw new DomainError("ERASURE_POLICY_REQUIRED");
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);
    const rows=await tx.outboxMessage.findMany({where:{type:"AUTH_EMAIL",createdAt:{lt:cutoff},OR:[{processedAt:{not:null}},{terminalAt:{not:null}}]},select:{id:true}}),ids=rows.map(r=>r.id);
    await tx.emailDelivery.updateMany({where:{outboxMessageId:{in:ids}},data:{recipientHash:null,providerMessageId:null,lastFailureCode:null}});
    await tx.outboxMessage.updateMany({where:{id:{in:ids}},data:{payload:{},recoveryPayload:{}}});
    await tx.auditEvent.create({data:{actorType:"ADMIN",actorUserId:actor.userId,action:"AUTH_METADATA_PURGED",entityType:"PrivacyOperation",entityId:randomUUID(),correlationId:actor.correlationId,metadata:{reference:operationReference,policyReference}}});return {count:ids.length};
  });
}
