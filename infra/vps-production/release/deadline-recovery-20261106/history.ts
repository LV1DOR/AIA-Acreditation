import {createDatabase} from './packages/database/src/index.ts';
import {target,marked} from './production-ops/guard.ts';
import {decryptSubmissionSnapshot} from './packages/domain/src/submissions/snapshot-crypto.ts';
const EVENT='c995c218-d0f3-47b0-bf11-f6c7e841190d',AUDIT='d122d026-2c3e-4293-8d9d-9254aa7fd9c5',CORRELATION='a5cbada9-f8ef-4c2a-8ed3-dcf59311c672';
const iso=(value:Date|null)=>value?.toISOString()??null;
const stable=(value:unknown)=>JSON.stringify(value);
const db=createDatabase(process.env.DATABASE_URL!);
try{
 target(process.env.DATABASE_URL);await marked(db);
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const event=await tx.event.findUniqueOrThrow({where:{id:EVENT}});
  const edit=await tx.auditEvent.findUniqueOrThrow({where:{id:AUDIT}});
  if(edit.eventId!==EVENT||edit.correlationId!==CORRELATION||event.version!==5||iso(event.onboardingClosesAt)!=='2026-11-10T23:55:00.000Z')throw Error('EVENT_CHANGED_SINCE_INSPECTION');
  const changes=await tx.auditEvent.findMany({where:{eventId:EVENT,action:'APPROVAL_INVALIDATED',entityType:'CompanyEventRegistration',correlationId:CORRELATION},orderBy:{entityId:'asc'}});
  const registrations=[];
  for(const change of changes){
   const r=await tx.companyEventRegistration.findUniqueOrThrow({where:{id:change.entityId},include:{company:true,zones:{include:{eventZone:{include:{zone:true}}}},vehiclePass:true,participants:{include:{jobRole:true,workDays:true,individualZones:{include:{eventZone:{include:{zone:true}}}}}},submissions:{orderBy:{version:'desc'},take:1,include:{reviews:{orderBy:[{createdAt:'desc'},{id:'desc'}]},participantReviews:true}}}});
   const submission=r.submissions[0];
   const reviews=submission?.reviews.slice(0,8).map(x=>({id:x.id,outcome:x.outcome,createdAt:x.createdAt,millisecondsFromEventAudit:x.createdAt.getTime()-edit.occurredAt.getTime(),reviewerMatchesEventActor:x.reviewedByUserId===edit.actorUserId}))??[];
   const info={registrationId:r.id,status:r.status,currentVersion:r.version,invalidationVersion:(change.metadata as {version?:number}).version,withdrawn:Boolean(r.withdrawnAt),erased:Boolean(r.erasedAt),latestSubmissionId:submission?.id,latestSubmissionVersion:submission?.version,latestSubmissionAt:submission?.submittedAt,registrationAuditAt:change.occurredAt,latestReviews:reviews,snapshotReadable:false}as Record<string,unknown>;
   if(submission&&process.env.DOCUMENT_ENCRYPTION_KEY){
    try{
     const snapshot=decryptSubmissionSnapshot(submission.snapshot,process.env.DOCUMENT_ENCRYPTION_KEY,submission.id)as {event:Record<string,string>;company:{id:string;name:string;internalOrganisation:string|null};registration:{id:string;personnelLimit:number};zones:{id:string;name:string}[];vehiclePass:unknown;participants:Record<string,unknown>[]};
     const active=r.participants.filter(p=>!['REMOVED','REPLACED'].includes(p.status)&&!p.erasedAt);
     const previous=new Map(snapshot.participants.map(p=>[p.id,p]));
     const counts={activeWorkers:active.length,snapshotWorkers:snapshot.participants.length,identicalContent:0,awaitingWithOneVersionIncrement:0,alreadyLeaderApproved:0,changedContentOrMissing:0,otherVersionOrStatus:0};
     for(const person of active){
      const p=previous.get(person.id);
      const current={fullName:person.fullName,dateOfBirth:iso(person.dateOfBirth),documentType:person.documentType,documentNumberCiphertext:person.documentNumberCiphertext,documentNumberIv:person.documentNumberIv,documentNumberAuthTag:person.documentNumberAuthTag,documentNumberKeyVersion:person.documentNumberKeyVersion,documentNumberFingerprint:person.documentNumberFingerprint,documentNumberLast3:person.documentNumberLast3,documentExpiryDate:iso(person.documentExpiryDate),mobileE164:person.mobileE164,nationalityCode:person.nationalityCode,photoObjectKey:person.photoObjectKey,privacyNoticeVersion:person.privacyNoticeVersion,privacyAcknowledgedAt:iso(person.privacyAcknowledgedAt),jobRole:person.jobRole?{id:person.jobRole.id,name:person.jobRole.name}:null};
      const same=p&&Object.entries(current).every(([key,value])=>stable(value)===stable(p[key]))&&stable(person.workDays.map(d=>iso(d.workDate)).sort())===stable((p.workDays as string[]).slice().sort())&&stable(person.individualZones.map(z=>({id:z.zoneId,name:z.eventZone.zone.name})).sort((a,b)=>a.id.localeCompare(b.id)))===stable(((p.zones??[])as {id:string;name:string}[]).slice().sort((a,b)=>a.id.localeCompare(b.id)));
      if(!same){counts.changedContentOrMissing++;continue;}counts.identicalContent++;
      if(person.status==='AWAITING_LEADER_REVIEW'&&person.version===Number(p.version)+1)counts.awaitingWithOneVersionIncrement++;
      else if(person.status==='LEADER_APPROVED')counts.alreadyLeaderApproved++;
      else counts.otherVersionOrStatus++;
     }
     const expectedEvent={id:event.id,name:event.name,startDate:iso(event.startDate),endDate:iso(event.endDate),onboardingOpensAt:iso(event.onboardingOpensAt),timezone:event.timezone};
     info.snapshotReadable=true;info.snapshotDeadline=snapshot.event.onboardingClosesAt;info.eventMatchesExceptDeadline=Object.entries(expectedEvent).every(([key,value])=>snapshot.event[key]===value);
     info.companyAndLimitMatch=snapshot.company.id===r.company.id&&snapshot.company.name===r.company.name&&snapshot.company.internalOrganisation===r.company.internalOrganisation&&snapshot.registration.personnelLimit===r.personnelLimit&&!r.company.deactivatedAt;
     info.zonesMatch=stable(r.zones.map(z=>({id:z.zoneId,name:z.eventZone.zone.name})).sort((a,b)=>a.id.localeCompare(b.id)))===stable(snapshot.zones.slice().sort((a,b)=>a.id.localeCompare(b.id)));
     info.vehicleRequestMatches=stable(r.vehiclePass?{required:r.vehiclePass.required,requestedQuantity:r.vehiclePass.requestedQuantity,justification:r.vehiclePass.justification}:{required:false,requestedQuantity:0,justification:null})===stable(snapshot.vehiclePass);
     info.workerComparison=counts;
     info.participantReviews={approved:submission.participantReviews.filter(x=>x.outcome==='APPROVED').length,returned:submission.participantReviews.filter(x=>x.outcome==='RETURNED_FOR_CORRECTION').length};
    }catch{info.snapshotComparisonFailed=true;}
   }
   registrations.push(info);
  }
  return {passed:true,readOnly:true,databaseChanged:false,emailSent:false,eventId:EVENT,eventVersion:event.version,currentDeadline:event.onboardingClosesAt,eventAuditId:AUDIT,eventAuditAt:edit.occurredAt,decryptionKeyAvailable:Boolean(process.env.DOCUMENT_ENCRYPTION_KEY),registrations};
 },{isolationLevel:'RepeatableRead',timeout:90000});
 console.log(JSON.stringify(result));
}catch{console.log(JSON.stringify({passed:false,readOnly:true,databaseChanged:false,code:'DEADLINE_HISTORY_INSPECTION_FAILED_DETAILS_SUPPRESSED'}));process.exitCode=1;}
finally{await db.$disconnect();}
