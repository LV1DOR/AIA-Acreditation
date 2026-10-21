// Explicitly authorised one-shot erasure only; normal web/worker never receive executor credentials.
import {createDatabase} from '../packages/database/src/index.ts';
import {executePrivacyDatabaseErasure,executePrivacyEvidenceExpiry} from '../packages/domain/src/privacy/retention.ts';
import {check,target,marked,safe} from './guard.ts';
await safe(async()=>{
  target(process.env.DATABASE_URL,'aia_worker');target(process.env.PRIVACY_DATABASE_URL,'aia_erasure');
  const id=process.env.AIA_PRIVACY_JOB_ID,ref=process.env.AIA_PRIVACY_APPROVAL_REFERENCE;
  check(id&&/^[a-f0-9-]{36}$/.test(id)&&ref&&ref.length>=5,'EXPLICIT_ERASURE_JOB_APPROVAL_REQUIRED');
  const db=createDatabase(process.env.DATABASE_URL!),executor=createDatabase(process.env.PRIVACY_DATABASE_URL!);
  try{
    await marked(db);const job=await db.privacyErasureJob.findUniqueOrThrow({where:{id}});
    if(process.argv[2]==='personal-data'){
      check(job.authorisationReference===ref&&job.status==='QUEUED'&&!job.databaseErasedAt,'APPROVED_QUEUED_ERASURE_REQUIRED');
      await executePrivacyDatabaseErasure(executor,id);
    }else if(process.argv[2]==='evidence-expiry'){
      check(job.evidencePurgeReference===ref&&job.status==='COMPLETE'&&job.evidencePurgeRequestedAt,'APPROVED_EVIDENCE_EXPIRY_REQUIRED');
      await executePrivacyEvidenceExpiry(executor,id);
    }else throw Error('UNKNOWN_ERASURE_ACTION');
    console.log(JSON.stringify({passed:true,action:process.argv[2],allCopiesErased:false}));
  }finally{await db.$disconnect();await executor.$disconnect();}
});
