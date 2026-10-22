import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { syntheticMode, deploymentMode } from "@aia/config";
import {assertRestrictedDatabaseRuntime} from "../operations/database-role.ts";
import type { Tx } from "../shared/transaction.ts";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { resolveActor, requireAdmin } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";

import {sharedPrivacyNoticeKind,privacyActionReference} from "./settings.ts";

export type NoticeKind="WORKER"|"LEADER";
type Client=PrismaClient|Tx;
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export async function currentPrivacyNotice(db:Client,eventId:string,_kind:NoticeKind,locale:"pt"|"en"="pt") {
  const event=await db.event.findUniqueOrThrow({where:{id:eventId},select:{name:true}});
  const row=await db.privacyNotice.findFirst({where:{eventId,kind:sharedPrivacyNoticeKind,...(!syntheticMode()?{synthetic:false}:{})},orderBy:[{createdAt:"desc"},{id:"desc"}]});
  if(row) {const text=(locale==="pt"?row.textPt:row.textEn).replaceAll("{event}",event.name);return {id:row.id,version:row.version,text,hash:hash(text),locale,synthetic:row.synthetic};}
  if(!syntheticMode()) throw new DomainError("PRIVACY_CONFIGURATION_REQUIRED");
  const text=locale==="pt"?`Apenas dados sintéticos — ${event.name}. Texto de desenvolvimento, sem aprovação jurídica. Li este aviso de teste sobre os dados do trabalhador.`:`Synthetic data only — ${event.name}. Development text without legal approval. I have read this test worker-data notice.`;
  return {id:null,version:"test-v1",text,hash:hash(text),locale,synthetic:true};
}
export async function assertCollectionAllowed(db:Client,eventId:string) {
  if(deploymentMode()==="production")await assertRestrictedDatabaseRuntime(db);
  await currentPrivacyNotice(db,eventId,sharedPrivacyNoticeKind);
  if(!syntheticMode() && !await db.eventRetentionPolicy.findFirst({where:{eventId,synthetic:false}})) throw new DomainError("RETENTION_POLICY_REQUIRED");
}
export async function validateWorkerNoticeEvidence(db:Tx,people:{id:string;eventId:string;registrationId:string;privacyNoticeVersion:string|null}[]) {
  if(syntheticMode())return;
  const evidence=await db.privacyAcknowledgement.findMany({where:{participantId:{in:people.map(p=>p.id)}},select:{participantId:true,registrationId:true,eventId:true,noticeVersion:true,noticeId:true,presentedText:true,noticeHash:true}});
  const ids=evidence.flatMap(e=>e.noticeId?[e.noticeId]:[]),notices=await db.privacyNotice.findMany({where:{id:{in:ids},kind:"WORKER",synthetic:false},select:{id:true,eventId:true,version:true}});
  if(people.some(p=>!evidence.some(e=>e.participantId===p.id&&e.registrationId===p.registrationId&&e.eventId===p.eventId&&e.noticeVersion===p.privacyNoticeVersion&&e.noticeHash===hash(e.presentedText)&&notices.some(n=>n.id===e.noticeId&&n.eventId===p.eventId&&n.version===e.noticeVersion))))throw new DomainError("SUBMISSION_INCOMPLETE");
}
export async function assertRegistrationNotErasing(db:Client,registrationId:string) {
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:registrationId},select:{erasedAt:true,withdrawnAt:true,eventId:true}});
  if(r.withdrawnAt || r.erasedAt || await db.privacyErasureJob.count({where:{registrationId,status:{not:"CANCELLED"}}})) throw new DomainError("EDIT_LOCKED");
  await assertCollectionAllowed(db,r.eventId);
}
const noticeInput=z.object({eventId:z.uuid(),kind:z.literal(sharedPrivacyNoticeKind).default(sharedPrivacyNoticeKind),version:z.string().trim().min(1).max(100),textPt:z.string().trim().min(20).max(30000),textEn:z.string().trim().min(20).max(30000),approvalReference:z.string().trim().min(5).max(200).optional(),approved:z.literal(true)}).strict();
export async function publishPrivacyNotice(db:PrismaClient,context:ActorContext,raw:z.input<typeof noticeInput>) {
  const input=noticeInput.parse(raw);
  return transaction(db,async tx=>{const actor=await resolveActor(tx,context);requireAdmin(actor);await tx.event.findUniqueOrThrow({where:{id:input.eventId}});
    const row=await tx.privacyNotice.create({data:{eventId:input.eventId,kind:input.kind,version:input.version,textPt:input.textPt,textEn:input.textEn,contentHash:hash(JSON.stringify([input.textPt,input.textEn])),approvalReference:input.approvalReference??privacyActionReference(actor.correlationId),approvedByUserId:actor.userId,synthetic:syntheticMode()}});
    await tx.auditEvent.create({data:{actorType:"ADMIN",actorUserId:actor.userId,action:"PRIVACY_NOTICE_PUBLISHED",entityType:"PrivacyNotice",entityId:row.id,eventId:input.eventId,correlationId:actor.correlationId,metadata:{}}});return row;
  });
}
export async function recordPrivacyAcknowledgement(db:Tx,raw:{eventId:string;registrationId:string;participantId?:string;submissionId?:string;actorType:string;actorUserId?:string;kind:NoticeKind;version:string;locale?:"pt"|"en";presentedHash?:string}) {
  const notice=await currentPrivacyNotice(db,raw.eventId,raw.kind,raw.locale??"pt");
  if(raw.version!==notice.version || (raw.presentedHash && raw.presentedHash!==notice.hash) || (!syntheticMode() && !raw.presentedHash)) throw new DomainError("PRIVACY_NOTICE_CHANGED");
  return db.privacyAcknowledgement.create({data:{noticeId:notice.id,eventId:raw.eventId,registrationId:raw.registrationId,participantId:raw.participantId,submissionId:raw.submissionId,actorType:raw.actorType,actorUserId:raw.actorUserId,locale:notice.locale,noticeVersion:notice.version,noticeHash:notice.hash,presentedText:notice.text}});
}
