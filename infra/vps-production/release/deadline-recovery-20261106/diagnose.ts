import {createDatabase} from './packages/database/src/index.ts';
import {target,marked} from './production-ops/guard.ts';

// Select metadata only. Never return snapshot plaintext, worker/company names,
// addresses, authentication tokens or credentials.
const db=createDatabase(process.env.DATABASE_URL!);
try {
 target(process.env.DATABASE_URL);await marked(db);
 const report=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const events=await tx.event.findMany({where:{onboardingClosesAt:{gte:new Date('2026-11-10T00:00:00Z'),lt:new Date('2026-11-11T00:00:00Z')},status:{notIn:['DRAFT','ARCHIVED']}},select:{id:true,name:true,version:true,onboardingClosesAt:true},take:20});
  const results=[];
  for(const event of events){
   const edits=await tx.auditEvent.findMany({where:{eventId:event.id,entityType:'Event',action:'EVENT_UPDATED',occurredAt:{gte:new Date(Date.now()-72*3600*1000)}},orderBy:{occurredAt:'desc'},take:12,select:{id:true,occurredAt:true,correlationId:true,actorUserId:true,metadata:true}});
   const groups=[];
   for(const edit of edits){
    const changes=await tx.auditEvent.findMany({where:{eventId:event.id,action:'APPROVAL_INVALIDATED',entityType:'CompanyEventRegistration',correlationId:edit.correlationId},select:{entityId:true,occurredAt:true,metadata:true},take:2001});
    if(!changes.length)continue;
    let previouslyApproved=0,previouslyUnderReview=0,unchangedRegistrationAndLatestInvalidation=0,changedOrUnclear=0,workerStatusCounts:Record<string,number>={};
    for(const change of changes.slice(0,2000)){
     const registration=await tx.companyEventRegistration.findUnique({where:{id:change.entityId},select:{status:true,version:true,withdrawnAt:true,erasedAt:true,submissions:{orderBy:{version:'desc'},take:1,select:{id:true,version:true,reviews:{orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,outcome:true,createdAt:true,reviewedByUserId:true}}}},participants:{select:{status:true}}}});
     if(!registration){changedOrUnclear++;continue;}
     for(const person of registration.participants)workerStatusCounts[person.status]=(workerStatusCounts[person.status]??0)+1;
     const submission=registration.submissions[0];
     const sameTransaction=submission?.reviews.filter(r=>r.createdAt.getTime()===change.occurredAt.getTime()&&r.reviewedByUserId===edit.actorUserId)??[];
     const invalidation=sameTransaction.find(r=>r.outcome==='APPROVAL_INVALIDATED');
     const prior=submission?.reviews.find(r=>r.createdAt<change.occurredAt);
     if(invalidation&&prior?.outcome==='APPROVED'){
      previouslyApproved++;
      const metadata=change.metadata as {version?:number};
      if(registration.status==='RETURNED_FOR_CORRECTION'&&!registration.withdrawnAt&&!registration.erasedAt&&registration.version===metadata.version&&submission?.reviews[0]?.id===invalidation.id)unchangedRegistrationAndLatestInvalidation++;
      else changedOrUnclear++;
     }else if(sameTransaction.some(r=>r.outcome==='RETURNED_FOR_CORRECTION'))previouslyUnderReview++;
     else changedOrUnclear++;
    }
    groups.push({eventAuditId:edit.id,occurredAt:edit.occurredAt,correlationId:edit.correlationId,eventVersionAtEdit:(edit.metadata as {version?:number}).version,affectedRegistrations:changes.length,truncated:changes.length>2000,previouslyApproved,previouslyUnderReview,unchangedRegistrationAndLatestInvalidation,changedOrUnclear,workerStatusCounts});
   }
   results.push({eventId:event.id,eventName:event.name,eventVersion:event.version,currentDeadline:event.onboardingClosesAt,invalidationGroups:groups});
  }
  return {passed:true,readOnly:true,databaseChanged:false,emailSent:false,servicesRestarted:false,events:results};
 },{isolationLevel:'RepeatableRead',timeout:90000});
 console.log(JSON.stringify(report));
}catch{
 console.log(JSON.stringify({passed:false,code:'READ_ONLY_DEADLINE_DIAGNOSTIC_FAILED_DETAILS_SUPPRESSED',databaseChanged:false}));process.exitCode=1;
}finally{await db.$disconnect();}
