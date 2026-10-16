import {createHash} from "node:crypto";
import type {PrismaClient} from "@aia/database";
import type {ActorContext} from "../shared/actor.ts";
import {requireAdmin,resolveActor} from "../auth/authorization.ts";
import {transaction} from "../shared/transaction.ts";
import {decryptSubmissionSnapshot} from "../submissions/snapshot-crypto.ts";
import {DomainError} from "../shared/errors.ts";
export async function orphanPhotoPreview(db:PrismaClient,context:ActorContext,listed:{objects:{key:string;lastModified:Date;size:number}[];truncated:boolean},key:string,now=new Date()) {
  requireAdmin(await resolveActor(db,context));
  const [people,snapshots,adjustments,staged,deleting]=await Promise.all([db.eventParticipant.findMany({where:{photoObjectKey:{not:null}},select:{photoObjectKey:true}}),db.companySubmission.findMany({select:{id:true,snapshot:true}}),db.submissionPhotoAdjustment.findMany({select:{photoObjectKey:true}}),db.photoUpload.findMany({where:{status:{in:["STAGED","CLEANING"]},expiresAt:{gt:now}},select:{objectKey:true}}),db.storageDeletion.findMany({where:{status:{not:"VERIFIED"}},select:{objectKey:true}})]);
  const refs=new Set([...people.map(p=>p.photoObjectKey),...adjustments.map(p=>p.photoObjectKey),...staged.map(p=>p.objectKey),...deleting.map(p=>p.objectKey)]);
  for(const s of snapshots){const v=decryptSubmissionSnapshot(s.snapshot,key,s.id) as {participants?:{photoObjectKey?:string}[]};for(const p of v.participants??[])if(p.photoObjectKey)refs.add(p.photoObjectKey);}
  const candidates=listed.objects.filter(o=>o.key.startsWith("photos/")&&!refs.has(o.key)&&now.getTime()-o.lastModified.getTime()>86400000);
  return {candidates,truncated:listed.truncated,previewHash:createHash('sha256').update(JSON.stringify(candidates)).digest('hex')};
}
export async function queueApprovedOrphanDeletion(db:PrismaClient,context:ActorContext,eventId:string,bucket:string,objectKeys:string[],authorisationReference:string,encryptionKey:string) {
  if(authorisationReference.trim().length<5||!objectKeys.length||objectKeys.length>1000||objectKeys.some(k=>!k.startsWith(`photos/${eventId}/`)))throw new DomainError("INVALID_INPUT");
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);const policy=await tx.eventRetentionPolicy.findFirst({where:{eventId},orderBy:{createdAt:"desc"}});if(!policy||policy.recordsEraseAfter>new Date()||await tx.eventPrivacyHold.count({where:{eventId,active:true}}))throw new DomainError("ERASURE_POLICY_REQUIRED");
    const snapshots=await tx.companySubmission.findMany({where:{registration:{eventId}},select:{id:true,snapshot:true}}),historical=new Set<string>();
    for(const s of snapshots){const v=decryptSubmissionSnapshot(s.snapshot,encryptionKey,s.id) as {participants?:{photoObjectKey?:string}[]};for(const p of v.participants??[])if(p.photoObjectKey)historical.add(p.photoObjectKey);}
    // Historical references are enforced again inside the mutation transaction.
    for(const objectKey of objectKeys){if(historical.has(objectKey)||await tx.eventParticipant.count({where:{photoObjectKey:objectKey}})||await tx.submissionPhotoAdjustment.count({where:{photoObjectKey:objectKey}})||await tx.photoUpload.count({where:{objectKey,status:{not:"CLEANED"}}}))throw new DomainError("ERASURE_BLOCKED");await tx.storageDeletion.upsert({where:{bucket_objectKey:{bucket,objectKey}},create:{bucket,objectKey,eventId,policyId:policy.id,authorisationReference},update:{status:"PENDING",availableAt:new Date(),eventId,policyId:policy.id,authorisationReference}});}
    await tx.auditEvent.create({data:{actorType:"ADMIN",actorUserId:actor.userId,action:"ORPHAN_CLEANUP_REQUESTED",entityType:"Event",entityId:eventId,eventId,correlationId:actor.correlationId,metadata:{}}});
  });
}
