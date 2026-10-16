import {afterAll,expect,it,vi} from "vitest";
import {db} from "./database.ts";
import {fixture} from "../fixtures/foundation.ts";
import {readyConfiguration,readyPerson,syntheticPhoto} from "../fixtures/security.ts";
import {currentPrivacyNotice,publishPrivacyNotice,recordPrivacyAcknowledgement,approveEventRetentionPolicy,setEventPrivacyHold,previewPrivacyErasure,requestPrivacyErasure,executePrivacyDatabaseErasure,cleanupNextStorageDeletion,reconcilePrivacyErasure,attestExternalErasureCopies,submitCompanyRegistration,reviewSubmissionParticipant,reviewCompanySubmission,workerEffectiveAccess,updateParticipantByLeader,privacyOperationsOverview,requestPrivacyEvidenceExpiry,executePrivacyEvidenceExpiry} from "../../packages/domain/src/index.ts";
import {transaction} from "../../packages/domain/src/shared/transaction.ts";
import {randomUUID} from "node:crypto";
import {purgeApprovedAuthenticationMetadata,queueApprovedOrphanDeletion} from "../../packages/domain/src/index.ts";
const key="1".repeat(64),keys={encryptionKey:key,fingerprintKey:"2".repeat(64)};
afterAll(()=>db.$disconnect());
const policy=(eventId:string)=>({eventId,recordsEraseAfter:new Date('2020-01-01'),evidenceEraseAfter:new Date('2020-02-01'),communicationsEraseAfter:new Date('2020-01-01'),backupsEraseAfter:new Date('2030-01-01'),approvalReference:'SYNTHETIC-AIA-POLICY',approved:true as const,automaticPurge:false as const});
it('F06 stores bilingual event text, rejects invented or changed versions and protects historical acknowledgements',async()=>{
  const f=await fixture(db);
  await publishPrivacyNotice(db,f.adminActor,{eventId:f.event.id,kind:'WORKER',version:'approved-v1',textPt:'Aviso sintético aprovado para {event}; apenas teste.',textEn:'Approved synthetic notice for {event}; test only.',approvalReference:'SYNTHETIC-APPROVAL-1',approved:true});
  const notice=await currentPrivacyNotice(db,f.event.id,'WORKER','en');expect(notice.text).toContain(f.event.name);expect(notice.text).not.toContain('MotoGP');
  const ack=await transaction(db,tx=>recordPrivacyAcknowledgement(tx,{eventId:f.event.id,registrationId:f.registration.id,actorType:'COMPANY_LEADER',actorUserId:f.leader.id,kind:'WORKER',version:notice.version,locale:'en'}));
  expect(ack).toMatchObject({noticeVersion:'approved-v1',presentedText:notice.text,noticeHash:notice.hash,actorUserId:f.leader.id,locale:'en'});
  await expect(transaction(db,tx=>recordPrivacyAcknowledgement(tx,{eventId:f.event.id,registrationId:f.registration.id,actorType:'EMPLOYEE_LINK',kind:'WORKER',version:'client-invented'}))).rejects.toThrow('PRIVACY_NOTICE_CHANGED');
  await expect(transaction(db,tx=>recordPrivacyAcknowledgement(tx,{eventId:f.event.id,registrationId:f.registration.id,actorType:'EMPLOYEE_LINK',kind:'WORKER',version:notice.version,presentedHash:'0'.repeat(64)}))).rejects.toThrow('PRIVACY_NOTICE_CHANGED');
  vi.stubEnv('DEPLOYMENT_ENV','production');try{await expect(currentPrivacyNotice(db,f.event.id,'WORKER','en')).rejects.toThrow('PRIVACY_CONFIGURATION_REQUIRED');}finally{vi.unstubAllEnvs();}
  await expect(db.privacyNotice.update({where:{id:notice.id!},data:{textEn:'Changed'}})).rejects.toThrow();
  await publishPrivacyNotice(db,f.adminActor,{eventId:f.event.id,kind:'WORKER',version:'approved-v2',textPt:'Segundo aviso sintético para {event}; apenas teste.',textEn:'Second synthetic notice for {event}; test only.',approvalReference:'SYNTHETIC-APPROVAL-2',approved:true});
  expect((await db.privacyAcknowledgement.findUniqueOrThrow({where:{id:ack.id}})).presentedText).toBe(notice.text);
  await expect(db.privacyAcknowledgement.delete({where:{id:ack.id}})).rejects.toThrow();
  await expect(privacyOperationsOverview(db,f.leaderActor,f.event.id)).rejects.toThrow('FORBIDDEN');
});
it('F07 preview blocks missing policies, future dates and holds, with no destructive automatic default',async()=>{
  const f=await fixture(db);await readyPerson(db,f);
  expect((await previewPrivacyErasure(db,f.adminActor,f.registration.id,key)).blockers).toContain('APPROVED_POLICY_REQUIRED');
  await expect(approveEventRetentionPolicy(db,f.leaderActor,policy(f.event.id))).rejects.toThrow('FORBIDDEN');
  await approveEventRetentionPolicy(db,f.adminActor,{...policy(f.event.id),recordsEraseAfter:new Date('2030-01-01'),evidenceEraseAfter:new Date('2031-01-01')});
  expect((await previewPrivacyErasure(db,f.adminActor,f.registration.id,key)).blockers).toContain('RETENTION_DATE_NOT_REACHED');
  await approveEventRetentionPolicy(db,f.adminActor,policy(f.event.id));await setEventPrivacyHold(db,f.adminActor,f.event.id,true,'SYNTHETIC-HOLD');
  const p=await previewPrivacyErasure(db,f.adminActor,f.registration.id,key);expect(p.blockers).toContain('LEGAL_HOLD');
  await expect(requestPrivacyErasure(db,f.adminActor,{registrationId:p.registrationId,expectedVersion:p.registrationVersion,previewHash:p.previewHash,authorisationReference:'SYNTHETIC-RIGHTS-REQUEST',confirmed:true},key,'aia-phase1-synthetic')).rejects.toThrow('ERASURE_POLICY_REQUIRED');
  expect(await db.eventParticipant.count({where:{registrationId:f.registration.id,fullName:{not:null}}})).toBe(1);
});
it('F08 restricted historical erasure keeps ordinary immutability, survives storage outage, accounts for backups and purges evidence only under approved policy',async()=>{
  const f=await fixture(db);await readyConfiguration(db,f);const person=await readyPerson(db,f,'Synthetic privacy erasure worker');
  const s=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,dataProcessingAccepted:true,dataProcessingNoticeVersion:'test-v1'},key);
  await reviewSubmissionParticipant(db,f.adminActor,{submissionId:s.id,participantId:person.id,outcome:'APPROVED'});await reviewCompanySubmission(db,f.adminActor,{submissionId:s.id,expectedRegistrationVersion:2,action:'APPROVE'});
  await db.submissionPhotoAdjustment.create({data:{submissionId:s.id,participantId:person.id,adjustedByUserId:f.admin.id,photoObjectKey:person.photoObjectKey+'-adjusted'}});
  await approveEventRetentionPolicy(db,f.adminActor,policy(f.event.id));
  const preview=await previewPrivacyErasure(db,f.adminActor,f.registration.id,key);expect(preview.counts).toMatchObject({participants:1,snapshots:1,photos:2,acknowledgements:1});
  const job=await requestPrivacyErasure(db,f.adminActor,{registrationId:preview.registrationId,expectedVersion:preview.registrationVersion,previewHash:preview.previewHash,authorisationReference:'SYNTHETIC-ERASURE-AUTH',confirmed:true},key,'aia-phase1-synthetic');
  expect((await workerEffectiveAccess(db,f.adminActor,person.id,key)).effective).toEqual([]);
  await expect(db.companySubmission.update({where:{id:s.id},data:{snapshot:{crafted:true}}})).rejects.toThrow();
  await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aia_phase3_runtime_test') THEN CREATE ROLE aia_phase3_runtime_test NOLOGIN; END IF; END $$`);
  await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO aia_phase3_runtime_test');
  await db.$executeRawUnsafe('GRANT SELECT,UPDATE ON "CompanySubmission" TO aia_phase3_runtime_test');
  await db.$executeRawUnsafe('GRANT SELECT ON "PrivacyErasureJob" TO aia_phase3_runtime_test');
  await expect(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE aia_phase3_runtime_test');await tx.$queryRaw`SELECT set_config('aia.privacy_job',${job.id},true)`;await tx.$executeRaw`UPDATE "CompanySubmission" SET snapshot='{}' WHERE id=${s.id}::uuid`;})).rejects.toThrow();
  await expect(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE aia_phase3_runtime_test');await tx.$queryRaw`SELECT public.execute_privacy_erasure(${job.id}::uuid)::text`;})).rejects.toThrow();
  // Execute with the actual restricted executor role, not a globally disabled trigger.
  await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE aia_privacy_executor');await tx.$queryRaw`SELECT public.execute_privacy_erasure(${job.id}::uuid)::text`;});
  await executePrivacyDatabaseErasure(db,job.id); // committed response lost: idempotent replay
  const erased=await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}});expect(erased).toMatchObject({fullName:null,documentNumberCiphertext:null,photoObjectKey:null,status:'REMOVED'});
  const historical=await db.companySubmission.findUniqueOrThrow({where:{id:s.id}});expect(historical.snapshot).toMatchObject({erased:true,participants:[]});expect(historical.contentHash).toBe(s.contentHash);
  expect(await db.companySubmissionReview.count({where:{submissionId:s.id,outcome:'APPROVED'}})).toBe(1);
  expect(await cleanupNextStorageDeletion(db,async()=>{throw Error('synthetic outage');},new Date(),job.id)).toBe('RETRY');
  const rows=await db.storageDeletion.findMany({where:{jobId:job.id}});expect(rows.some(r=>r.lastFailureCode==='STORAGE_ERASURE_FAILED')).toBe(true);
  await db.storageDeletion.updateMany({where:{jobId:job.id},data:{availableAt:new Date(0)}});
  for(let n=0;n<20 && await db.storageDeletion.count({where:{jobId:job.id,status:{not:'VERIFIED'}}});n++)await cleanupNextStorageDeletion(db,async()=>{},new Date(),job.id);
  expect(await reconcilePrivacyErasure(db,job.id)).toBe('COPIES_PENDING');
  const backup=await db.backupRun.create({data:{status:'VERIFIED',destination:'SYNTHETIC-NOT-A-REAL-ARCHIVE',createdAt:new Date(0),expiresAt:new Date(0),verifiedAt:new Date()}});
  expect(await attestExternalErasureCopies(db,f.adminActor,job.id,'SYNTHETIC-EXTERNAL-COPY-CHECK')).toBe('COPIES_PENDING');
  await db.backupRun.update({where:{id:backup.id},data:{status:'DELETED',deletedAt:new Date()}});
  expect(await reconcilePrivacyErasure(db,job.id)).toBe('COMPLETE');
  await expect(db.companySubmission.delete({where:{id:s.id}})).rejects.toThrow();
  const full=await previewPrivacyErasure(db,f.adminActor,f.registration.id,key,'ALL_EVIDENCE');
  const final=await requestPrivacyErasure(db,f.adminActor,{registrationId:full.registrationId,expectedVersion:full.registrationVersion,previewHash:full.previewHash,stage:'ALL_EVIDENCE',authorisationReference:'SYNTHETIC-EVIDENCE-EXPIRY',confirmed:true},key,'aia-phase1-synthetic');
  await executePrivacyDatabaseErasure(db,final.id);expect(await db.companySubmission.count({where:{id:s.id}})).toBe(0);expect(await db.companyEventRegistration.count({where:{id:f.registration.id}})).toBe(0);
  await attestExternalErasureCopies(db,f.adminActor,final.id,"SYNTHETIC-FINAL-EVIDENCE-COPIES");
  await requestPrivacyEvidenceExpiry(db,f.adminActor,job.id,'SYNTHETIC-RECEIPT-EXPIRY');await executePrivacyEvidenceExpiry(db,job.id);expect(await db.privacyErasureJob.count({where:{id:job.id}})).toBe(0);expect(await db.auditEvent.count({where:{entityId:job.id}})).toBe(0);
});
it('F06 a forged worker version rolls back photo adoption and retains the valid completion path',async()=>{
  const f=await fixture(db),p=await readyPerson(db,f);await db.eventParticipant.update({where:{id:p.id},data:{status:'DRAFT',privacyAcknowledgedAt:null,privacyNoticeVersion:null}});
  const details={fullName:p.fullName!,dateOfBirth:'1990-01-01',documentType:'PASSPORT' as const,documentExpiryDate:'2035-01-01',mobile:'+351912345678',nationalityCode:'PT',jobRoleId:p.jobRoleId!,workDays:['2026-10-01'],privacyAcknowledged:true,privacyNoticeVersion:'forged-v9'};
  const photo=await syntheticPhoto(db,p.id);await expect(updateParticipantByLeader(db,f.leaderActor,p.id,details,keys,photo)).rejects.toThrow('PRIVACY_NOTICE_CHANGED');expect((await db.photoUpload.findUniqueOrThrow({where:{objectKey:photo}})).status).toBe('STAGED');
  await updateParticipantByLeader(db,f.leaderActor,p.id,{...details,privacyNoticeVersion:'test-v1',noticeLocale:'en'},keys,photo);expect((await db.privacyAcknowledgement.findFirstOrThrow({where:{participantId:p.id}})).locale).toBe('en');
});
it('F07 a changed approved policy invalidates an erasure preview instead of silently authorising a different scope',async()=>{
 const f=await fixture(db);await readyPerson(db,f);await approveEventRetentionPolicy(db,f.adminActor,policy(f.event.id));const p=await previewPrivacyErasure(db,f.adminActor,f.registration.id,key);
 await approveEventRetentionPolicy(db,f.adminActor,{...policy(f.event.id),approvalReference:'SYNTHETIC-NEW-POLICY'});
 await expect(requestPrivacyErasure(db,f.adminActor,{registrationId:p.registrationId,expectedVersion:p.registrationVersion,previewHash:p.previewHash,authorisationReference:'SYNTHETIC-STale-PREVIEW',confirmed:true},key,'aia-phase1-synthetic')).rejects.toThrow('STALE_WRITE');
});
it('F07 authentication metadata expiry requires an approved cutoff and preserves live pending credentials',async()=>{
 const f=await fixture(db);
 const make=async(terminal:boolean)=>db.outboxMessage.create({data:{type:'AUTH_EMAIL',deduplicationKey:randomUUID(),payload:{synthetic:'credential'},createdAt:new Date('1999-01-01'),terminalAt:terminal?new Date():null,emailDelivery:{create:{status:terminal?'FAILED':'QUEUED',recipientHash:'a'.repeat(64),providerMessageId:'synthetic-provider-id'}}}});
 const expired=await make(true),pending=await make(false);
 vi.stubEnv('AUTH_METADATA_ERASE_BEFORE','');vi.stubEnv('AUTH_METADATA_POLICY_REFERENCE','');
 try {
  await expect(purgeApprovedAuthenticationMetadata(db,f.adminActor,'SYNTHETIC-METADATA-ERASURE')).rejects.toThrow('ERASURE_POLICY_REQUIRED');
  vi.stubEnv('AUTH_METADATA_ERASE_BEFORE','2000-01-01T00:00:00Z');vi.stubEnv('AUTH_METADATA_POLICY_REFERENCE','SYNTHETIC-METADATA-POLICY');
  await expect(purgeApprovedAuthenticationMetadata(db,f.leaderActor,'SYNTHETIC-UNAUTHORISED')).rejects.toThrow('FORBIDDEN');
  await purgeApprovedAuthenticationMetadata(db,f.adminActor,'SYNTHETIC-METADATA-ERASURE');
  expect((await db.outboxMessage.findUniqueOrThrow({where:{id:expired.id}})).payload).toEqual({});
  expect(await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:expired.id}})).toMatchObject({recipientHash:null,providerMessageId:null});
  expect((await db.outboxMessage.findUniqueOrThrow({where:{id:pending.id}})).payload).toEqual({synthetic:'credential'});
 }finally{vi.unstubAllEnvs();await db.outboxMessage.update({where:{id:pending.id},data:{processedAt:new Date(),payload:{}}});}
});
it('F07 orphan cleanup rejects a photo referenced only by immutable submission history',async()=>{
 const f=await fixture(db);await readyConfiguration(db,f);const p=await readyPerson(db,f);
 const oldKey=`photos/${f.event.id}/${p.id}-historical.jpg`;await db.eventParticipant.update({where:{id:p.id},data:{photoObjectKey:oldKey}});
 await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,dataProcessingAccepted:true,dataProcessingNoticeVersion:'test-v1'},key);
 await db.eventParticipant.update({where:{id:p.id},data:{photoObjectKey:`photos/${f.event.id}/${p.id}-current.jpg`}});
 await approveEventRetentionPolicy(db,f.adminActor,policy(f.event.id));
 await expect(queueApprovedOrphanDeletion(db,f.adminActor,f.event.id,'aia-phase1-synthetic',[oldKey],'SYNTHETIC-ORPHAN-AUTH',key)).rejects.toThrow('ERASURE_BLOCKED');
 expect(await db.storageDeletion.count({where:{objectKey:oldKey}})).toBe(0);
});
