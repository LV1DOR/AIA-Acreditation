import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parse} from 'dotenv';
import {createDatabase} from './packages/database/src/index.ts';
import {target,marked} from './production-ops/guard.ts';
import {decryptSubmissionSnapshot,encryptSubmissionSnapshot} from './packages/domain/src/submissions/snapshot-crypto.ts';
import {validateRegistrationEligibility} from './packages/domain/src/submissions/eligibility.ts';
import {idAllAttendees} from './packages/domain/src/exports/id-all.ts';
import {weBookAttendees} from './packages/domain/src/exports/webook.ts';
import {EVENT,AUDIT,CORRELATION,DEADLINE,assertEvent,eligibility,recoverySnapshot} from './deadline_policy.mjs';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const db=createDatabase(process.env.DATABASE_URL!);let committed=false;
const mode=process.env.AIA_DEADLINE_RECOVERY_MODE;
async function inspect(tx:any){
 const event=await tx.event.findUniqueOrThrow({where:{id:EVENT}}),edit=await tx.auditEvent.findUniqueOrThrow({where:{id:AUDIT}});assertEvent(event,edit);
 const actor=await tx.user.findUniqueOrThrow({where:{id:edit.actorUserId}});if(actor.role!=='ADMIN'||actor.disabledAt)throw Error('ORIGINAL_EVENT_ADMIN_NOT_ACTIVE');
 const changes=await tx.auditEvent.findMany({where:{eventId:EVENT,action:'APPROVAL_INVALIDATED',entityType:'CompanyEventRegistration',correlationId:CORRELATION},orderBy:{entityId:'asc'}});
 if(changes.length!==16)throw Error('EXACT_SIXTEEN_AFFECTED_REGISTRATIONS_REQUIRED');
 const selected=[],excluded=[];
 for(const change of changes){
  const r=await tx.companyEventRegistration.findUniqueOrThrow({where:{id:change.entityId},include:{company:true,requests:{where:{status:'APPROVED',fulfilledBySubmissionId:null}},zones:{orderBy:{zoneId:'asc'},include:{eventZone:{include:{zone:true}}}},vehiclePass:true,participants:{orderBy:{id:'asc'},include:{jobRole:true,workDays:{orderBy:{workDate:'asc'}},individualZones:{orderBy:{zoneId:'asc'},include:{eventZone:{include:{zone:true}}}}}},submissions:{orderBy:{version:'desc'},take:1,include:{reviews:{orderBy:[{createdAt:'desc'},{id:'desc'}]},participantReviews:{orderBy:{participantId:'asc'}},photoAdjustments:{orderBy:[{createdAt:'desc'},{id:'desc'}]}}}}});
  const postAudits=await tx.auditEvent.findMany({where:{eventId:EVENT,entityType:'EventParticipant',entityId:{in:r.participants.map((p:any)=>p.id)},occurredAt:{gt:edit.occurredAt}},orderBy:{id:'asc'},select:{id:true,entityId:true,action:true}});
  const erasures=await tx.privacyErasureJob.count({where:{registrationId:r.id,status:{not:'CANCELLED'}}});
  let snapshot=null;
  try{if(r.submissions[0])snapshot=decryptSubmissionSnapshot(r.submissions[0].snapshot,process.env.DOCUMENT_ENCRYPTION_KEY!,r.submissions[0].id);}catch{}
  const decision=eligibility(event,edit,change,r,snapshot,postAudits,erasures);
  if(decision.eligible){
   if(hash(snapshot)!==r.submissions[0].contentHash)throw Error('SOURCE_SNAPSHOT_CONTENT_HASH_MISMATCH');
   selected.push({decision,proof:hash({event,edit,change,r,postAudits,erasures}),r,snapshot});
  }else excluded.push(decision);
 }
 const candidates=selected.map(x=>({...x.decision,proof:x.proof}));
 return {event,edit,actor,selected,excluded,candidates,planHash:hash({eventAuditId:AUDIT,eventVersion:event.version,deadline:DEADLINE,candidates})};
}
function publicPlan(p:any){return {passed:true,readOnly:true,eventId:EVENT,eventAuditId:AUDIT,eventVersion:5,deadline:DEADLINE,affectedRegistrations:16,eligibleRegistrations:p.selected.length,workersToRestore:p.selected.reduce((n:number,x:any)=>n+x.decision.restoreWorkers,0),workersInRecoveredRegistrations:p.selected.reduce((n:number,x:any)=>n+x.decision.workerCount,0),planHash:p.planHash,candidates:p.candidates,excluded:p.excluded,databaseChanged:false,emailSent:false};}
try{
 target(process.env.DATABASE_URL,'aia_web');await marked(db);
 const recoveryKey=parse(readFileSync('/run/secrets/deadline_recovery_env')).DOCUMENT_ENCRYPTION_KEY;
 if(process.env.DOCUMENT_ENCRYPTION_KEY&&process.env.DOCUMENT_ENCRYPTION_KEY!==recoveryKey)throw Error('RECOVERY_ENCRYPTION_KEY_MISMATCH');
 process.env.DOCUMENT_ENCRYPTION_KEY=recoveryKey;
 if(!/^[a-f0-9]{64}$/i.test(process.env.DOCUMENT_ENCRYPTION_KEY??''))throw Error('DOCUMENT_KEY_REQUIRED');
 if(mode==='preview'){
  const p=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return inspect(tx);},{isolationLevel:'RepeatableRead',timeout:120000});
  console.log(JSON.stringify(publicPlan(p)));
 }else if(mode==='apply'){
  if(process.env.AIA_DEADLINE_RECOVERY_CONFIRM!=='RESTORE_ONLY_PREVIOUS_APPROVALS_KEEP_10_NOVEMBER')throw Error('EXPLICIT_SCOPED_RECOVERY_APPROVAL_REQUIRED');
  const plan=JSON.parse(readFileSync('/tmp/deadline-recovery-plan.json','utf8'));
  if(plan.eventId!==EVENT||plan.eventAuditId!==AUDIT||plan.deadline!==DEADLINE||!/^[a-f0-9-]{36}$/.test(plan.recoveryId??''))throw Error('EXACT_RECOVERY_PLAN_REQUIRED');
  const receipt=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${EVENT}::uuid FOR UPDATE`;
   if(await tx.auditEvent.count({where:{action:'OPERATOR_DEADLINE_BATCH_RESTORED',correlationId:plan.recoveryId}}))throw Error('RECOVERY_ALREADY_COMMITTED_VERIFY_BEFORE_RETRY');
   const ids=plan.candidates.map((x:any)=>x.registrationId).sort();
   for(const id of ids){await tx.$queryRaw`SELECT id FROM "CompanyEventRegistration" WHERE id=${id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM "EventParticipant" WHERE "registrationId"=${id}::uuid FOR UPDATE`;}
   const current=await inspect(tx);
   if(current.planHash!==plan.planHash||current.selected.length!==plan.eligibleRegistrations||!current.selected.length)throw Error('RECOVERY_PLAN_CHANGED_NO_RECORDS_WRITTEN');
   const restored=[];
   for(const item of current.selected){
    const r=item.r,source=r.submissions[0];
    const affected=r.participants.filter((p:any)=>p.status==='AWAITING_LEADER_REVIEW');
    const changed=await tx.eventParticipant.updateMany({where:{registrationId:r.id,OR:affected.map((p:any)=>({id:p.id,version:p.version,status:'AWAITING_LEADER_REVIEW'}))},data:{status:'LEADER_APPROVED',version:{increment:1}}});
    if(changed.count!==affected.length)throw Error('WORKER_STATE_CHANGED_TRANSACTION_ROLLED_BACK');
    await validateRegistrationEligibility(tx,r.id);
    const snapshot=recoverySnapshot(item.snapshot,r,current.event,plan.recoveryId,new Date().toISOString());
    const nextId=randomUUID();
    await tx.companySubmission.create({data:{id:nextId,registrationId:r.id,version:source.version+1,registrationVersion:r.version,snapshot:encryptSubmissionSnapshot(JSON.stringify(snapshot),process.env.DOCUMENT_ENCRYPTION_KEY!,nextId),contentHash:hash(snapshot),submittedByUserId:current.actor.id}});
    await tx.submissionParticipantReview.createMany({data:source.participantReviews.map((review:any)=>({submissionId:nextId,participantId:review.participantId,outcome:'APPROVED',reviewedByUserId:review.reviewedByUserId}))});
    const seen=new Set();const photos=source.photoAdjustments.filter((x:any)=>{if(seen.has(x.participantId))return false;seen.add(x.participantId);return true;});
    if(photos.length)await tx.submissionPhotoAdjustment.createMany({data:photos.map((photo:any)=>({submissionId:nextId,participantId:photo.participantId,photoObjectKey:photo.photoObjectKey,adjustedByUserId:photo.adjustedByUserId}))});
    await tx.companySubmissionReview.create({data:{submissionId:nextId,outcome:'APPROVED',reviewedByUserId:current.actor.id}});
    const update=await tx.companyEventRegistration.updateMany({where:{id:r.id,version:r.version,status:'RETURNED_FOR_CORRECTION'},data:{status:'APPROVED',version:{increment:1}}});
    if(update.count!==1)throw Error('REGISTRATION_STATE_CHANGED_TRANSACTION_ROLLED_BACK');
    await tx.auditEvent.create({data:{actorType:'SYSTEM',actorUserId:current.actor.id,action:'OPERATOR_DEADLINE_APPROVAL_RESTORED',entityType:'CompanySubmission',entityId:nextId,eventId:EVENT,companyId:r.companyId,correlationId:plan.recoveryId,metadata:{eventAuditId:AUDIT,sourceSubmissionId:source.id,priorApprovalId:item.decision.previousApprovalId,sourceRegistrationVersion:r.version,restoredWorkers:changed.count,originalPrivacyAcknowledgementsUnchanged:true}}});
    restored.push({registrationId:r.id,submissionId:nextId,workers:item.decision.workerCount,restoredWorkers:changed.count});
   }
   await tx.auditEvent.create({data:{actorType:'SYSTEM',actorUserId:current.actor.id,action:'OPERATOR_DEADLINE_BATCH_RESTORED',entityType:'Event',entityId:EVENT,eventId:EVENT,correlationId:plan.recoveryId,metadata:{eventAuditId:AUDIT,planHash:plan.planHash,registrations:restored.length,workers:restored.reduce((n,x)=>n+x.workers,0)}}});
   await tx.outboxMessage.create({data:{deduplicationKey:'deadline-recovery:'+plan.recoveryId,type:'DOMAIN_INVALIDATION',eventId:EVENT,payload:{entityId:EVENT,eventId:EVENT,version:5}}});
   return {restored,recoveryId:plan.recoveryId};
  },{isolationLevel:'Serializable',timeout:120000});
  committed=true;
  console.log(JSON.stringify({passed:true,committed:true,eventId:EVENT,deadline:DEADLINE,recoveryId:receipt.recoveryId,restoredRegistrations:receipt.restored.length,restoredWorkers:receipt.restored.reduce((n,x)=>n+x.restoredWorkers,0),workersInRecoveredRegistrations:receipt.restored.reduce((n,x)=>n+x.workers,0),restored:receipt.restored,emailSent:false,historyPreserved:true,privacyEvidencePreserved:true}));
 }else if(mode==='verify'){
  const plan=JSON.parse(readFileSync('/tmp/deadline-recovery-plan.json','utf8'));
  const marker=await db.auditEvent.findFirst({where:{action:'OPERATOR_DEADLINE_BATCH_RESTORED',correlationId:plan.recoveryId,eventId:EVENT}});
  if(!marker)throw Error('RECOVERY_COMMIT_NOT_FOUND');
  const actor=await db.user.findUniqueOrThrow({where:{id:marker.actorUserId!}}),context={clerkUserId:actor.clerkUserId,correlationId:plan.recoveryId};
  const ids=plan.candidates.map((x:any)=>x.registrationId);
  const rows=await db.companyEventRegistration.findMany({where:{id:{in:ids}},include:{participants:{where:{status:{notIn:['REMOVED','REPLACED']}}},submissions:{orderBy:{version:'desc'},take:1,include:{reviews:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1}}}}});
  if(rows.length!==ids.length||rows.some(r=>r.status!=='APPROVED'||r.submissions[0]?.reviews[0]?.outcome!=='APPROVED'||r.participants.some(p=>p.status!=='LEADER_APPROVED')))throw Error('RECOVERED_STATUS_VERIFICATION_FAILED');
  const required=new Set(rows.flatMap(r=>r.participants.map(p=>p.id)));
  const cards=new Set((await idAllAttendees(db,context,EVENT,process.env.DOCUMENT_ENCRYPTION_KEY!)).map(p=>p.id));
  const webook=new Set((await weBookAttendees(db,context,EVENT,process.env.DOCUMENT_ENCRYPTION_KEY!)).map(p=>p.id));
  if([...required].some(id=>!cards.has(id)||!webook.has(id)))throw Error('RECOVERED_EXPORT_ELIGIBILITY_VERIFICATION_FAILED');
  const event=await db.event.findUniqueOrThrow({where:{id:EVENT}});if(event.version!==5||event.onboardingClosesAt.toISOString()!==DEADLINE)throw Error('RECOVERY_EVENT_DEADLINE_CHANGED');
  console.log(JSON.stringify({passed:true,recoveryVerified:true,recoveryId:plan.recoveryId,approvedRegistrations:rows.length,approvedWorkers:required.size,idAllAndWeBookEligibilityVerified:true,deadline:DEADLINE,emailSent:false}));
 }else throw Error('FIXED_RECOVERY_MODE_REQUIRED');
}catch(error){const code=error instanceof Error&&/^[A-Z0-9_]{4,100}$/.test(error.message)?error.message:'RECOVERY_FAILED_DETAILS_SUPPRESSED';console.log(JSON.stringify({passed:false,committed,code,emailSent:false}));process.exitCode=1;}
finally{await db.$disconnect();}
