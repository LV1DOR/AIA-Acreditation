import {createRequire} from "node:module";
import {processParticipantPhoto} from "../packages/storage/src/index.ts";
import {config} from "dotenv";
import {randomBytes,randomUUID} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {createDatabase} from "../packages/database/src/index.ts";
import {parseStorageEnv} from "../packages/config/src/index.ts";
import {createObjectStorage} from "../packages/storage/src/object-storage.ts";
import {fixture} from "../tests/fixtures/foundation.ts";
import {readyConfiguration,readyPerson} from "../tests/fixtures/security.ts";
import {submitCompanyRegistration,reviewSubmissionParticipant,reviewCompanySubmission,revealDocumentNumber,decryptSubmissionSnapshot} from "../packages/domain/src/index.ts";
import {createCoordinatedBackup,restoreCoordinatedBackup,digest,deleteExpiredLocalBackup} from "./lib/backup.ts";
config({quiet:true});process.env.DEPLOYMENT_ENV="test";process.env.AIA_SYNTHETIC_DATA="true";
const container="aia-phase3-recovery-test",dir=".impeccable/review/phase3/recovery/"+randomUUID();
// Never attach to or reset an existing database/container.
const exists=spawnSync('docker',['inspect',container],{stdio:'ignore',windowsHide:true});if(exists.status===0)throw new Error("REHEARSAL_CONTAINER_ALREADY_EXISTS");
execFileSync('docker',['run','--detach','--name',container,'--label','codex.task=aia-phase3-synthetic-recovery','--memory','512m','--cpus','1','-p','127.0.0.1:16433:5432','-e','POSTGRES_USER=phase3_synthetic','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=aia_phase3_source','postgres:17-alpine'],{stdio:'ignore',windowsHide:true});
const sourceUrl='postgresql://phase3_synthetic@127.0.0.1:16433/aia_phase3_source',restoreUrl='postgresql://phase3_synthetic@127.0.0.1:16433/aia_phase3_restore';
const source=createDatabase(sourceUrl);let restore:ReturnType<typeof createDatabase>|undefined;
try {
  for(let n=0;n<60;n++){try{await source.$queryRaw`SELECT 1`;break;}catch{await new Promise(r=>setTimeout(r,250));if(n===59)throw new Error('SYNTHETIC_POSTGRES_NOT_READY');}}
  const migration=spawnSync('corepack pnpm --filter @aia/database exec prisma migrate deploy',{shell:true,env:{...process.env,DATABASE_URL:sourceUrl},stdio:'pipe',windowsHide:true});if(migration.status!==0)throw new Error('REHEARSAL_MIGRATION_FAILED');
  await source.$executeRawUnsafe('CREATE DATABASE aia_phase3_restore');
  const f=await fixture(source);await readyConfiguration(source,f);const p=await readyPerson(source,f,"Synthetic restore worker");
  const e=parseStorageEnv(process.env),bucket='aia-phase3-backup-'+randomUUID(),restoreBucket='aia-phase3-restore-'+randomUUID();
  const storageOptions={endpoint:e.MINIO_ENDPOINT,accessKey:e.MINIO_ACCESS_KEY,secretKey:e.MINIO_SECRET_KEY,region:e.MINIO_REGION,bucket};if(!['127.0.0.1','localhost'].includes(new URL(e.MINIO_ENDPOINT).hostname))throw new Error('LOCAL_STORAGE_REQUIRED');
  const storage=createObjectStorage(storageOptions);await storage.ensureBucket();const sharp=createRequire(new URL("../packages/storage/package.json",import.meta.url))("sharp");const photo=await sharp({create:{width:48,height:48,channels:3,background:"#707070"}}).jpeg().toBuffer();await processParticipantPhoto(photo,"image/jpeg");await storage.putPhoto(p.photoObjectKey!,photo);
  const submission=await submitCompanyRegistration(source,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,dataProcessingAccepted:true,dataProcessingNoticeVersion:'test-v1'},'1'.repeat(64));const derivativeKey=`photos/synthetic/${p.id}-adjusted.jpg`,derivative=await sharp({create:{width:48,height:48,channels:3,background:"#c02030"}}).jpeg().toBuffer();await storage.putPhoto(derivativeKey,derivative);await source.submissionPhotoAdjustment.create({data:{submissionId:submission.id,participantId:p.id,adjustedByUserId:f.admin.id,photoObjectKey:derivativeKey}});await reviewSubmissionParticipant(source,f.adminActor,{submissionId:submission.id,participantId:p.id,outcome:"APPROVED"});await reviewCompanySubmission(source,f.adminActor,{submissionId:submission.id,expectedRegistrationVersion:2,action:'APPROVE'});
  await mkdir(dir,{recursive:true,mode:0o700});const archiveKey=randomBytes(32),custodyKey=randomBytes(32);await writeFile(dir+'/archive.key',archiveKey,{mode:0o600,flag:'wx'});await writeFile(dir+'/custody.key',custodyKey,{mode:0o600,flag:'wx'});
  const target={environment:'test' as const,host:'127.0.0.1',port:16433,database:'aia_phase3_source'},expiresAt=new Date(Date.now()+3600000);
  const receipt=await createCoordinatedBackup({databaseUrl:sourceUrl,target,container,storage:storageOptions,destination:dir+'/archives',workDirectory:dir+'/private-work',archiveKey,custodyKey,expiresAt,recoveryKeys:{DOCUMENT_ENCRYPTION_KEY:'1'.repeat(64),DOCUMENT_FINGERPRINT_KEY:'2'.repeat(64),AUTH_EMAIL_ENCRYPTION_KEY:'3'.repeat(64)}});
  const receiptFile=dir+'/archives/'+receipt.id+'.receipt.json',restoreOptions={receiptFile,databaseUrl:restoreUrl,target:{...target,database:'aia_phase3_restore'},container,storage:{...storageOptions,bucket:restoreBucket},archiveKey,custodyKey,workDirectory:dir+'/private-work'};
  let wrongKeyBlocked=false;try{await restoreCoordinatedBackup({...restoreOptions,custodyKey:randomBytes(32)});}catch{wrongKeyBlocked=true;}if(!wrongKeyBlocked)throw new Error('KEY_RECOVERY_GUARD_FAILED');
  const result=await restoreCoordinatedBackup(restoreOptions);restore=createDatabase(restoreUrl);
  // Roles/ACLs are intentionally excluded from business-data dumps; reapply reviewed privilege setup.
  await restore.$executeRawUnsafe('ALTER FUNCTION public.execute_privacy_erasure(uuid) OWNER TO aia_privacy_owner');
  const restored=await restore.eventParticipant.findUniqueOrThrow({where:{id:p.id}}),snapshot=await restore.companySubmission.findUniqueOrThrow({where:{id:submission.id}});
  const number=revealDocumentNumber(restored,result.recoveryKeys.DOCUMENT_ENCRYPTION_KEY);if(number!==p.id)throw new Error('DOCUMENT_RESTORE_FAILED');
  const original=decryptSubmissionSnapshot(submission.snapshot,'1'.repeat(64),submission.id),recovered=decryptSubmissionSnapshot(snapshot.snapshot,result.recoveryKeys.DOCUMENT_ENCRYPTION_KEY,snapshot.id);if(JSON.stringify(original)!==JSON.stringify(recovered))throw new Error('SNAPSHOT_RESTORE_FAILED');
  const restoredStorage=createObjectStorage(restoreOptions.storage);await processParticipantPhoto(await restoredStorage.getPhoto(p.photoObjectKey!),"image/jpeg");const adjustment=await restore.submissionPhotoAdjustment.findFirstOrThrow({where:{submissionId:submission.id}});if(digest(await restoredStorage.getPhoto(adjustment.photoObjectKey))!==digest(derivative))throw new Error("ADJUSTMENT_RESTORE_FAILED");const acknowledgement=await restore.privacyAcknowledgement.findFirstOrThrow({where:{submissionId:submission.id}});if(!acknowledgement.presentedText.includes(f.event.name))throw new Error("NOTICE_EVIDENCE_RESTORE_FAILED");if(digest(await restoredStorage.getPhoto(p.photoObjectKey!))!==digest(photo))throw new Error('PHOTOGRAPH_RESTORE_FAILED');
  let occupiedBlocked=false;try{await restoreCoordinatedBackup(restoreOptions);}catch{occupiedBlocked=true;}if(!occupiedBlocked)throw new Error('NONEMPTY_RESTORE_GUARD_FAILED');
  const evidence={passed:true,synthetic:true,containerMemoryBytes:512*1024*1024,recordsDecrypted:1,historicalSnapshotsVerified:1,photographsHashVerified:2,restoredJPEGDecoded:true,acknowledgementEvidenceVerified:true,wrongCustodyKeyBlocked:wrongKeyBlocked,nonemptyTargetBlocked:occupiedBlocked,restoredDatabaseQuarantined:result.quarantined,offSiteVerified:false,archiveChecksum:receipt.archiveHash};
  await writeFile(dir+'/result.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  await restoredStorage.erasePhotoAndVerify(derivativeKey);await storage.erasePhotoAndVerify(derivativeKey);await restoredStorage.erasePhotoAndVerify(p.photoObjectKey!);await storage.erasePhotoAndVerify(p.photoObjectKey!);
  // Explicitly scoped synthetic expiry exercises the archive deletion/ledger path.
  await deleteExpiredLocalBackup(source,receipt.id,dir+'/archives',new Date(expiresAt.getTime()+1000));
  await readFile(dir+'/result.json');
}finally{await source.$disconnect();await restore?.$disconnect();execFileSync('docker',['stop',container],{stdio:'ignore',windowsHide:true});}
