import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createDatabase} from '../packages/database/src/index.ts';
import {decryptSubmissionSnapshot,revealDocumentNumber,submitCompanyRegistration,reviewSubmissionParticipant,reviewCompanySubmission,recordPrivacyAcknowledgement} from '../packages/domain/src/index.ts';
import {fixture} from '../tests/fixtures/foundation.ts';
import {readyPerson,readyConfiguration} from '../tests/fixtures/security.ts';
import {transaction} from '../packages/domain/src/shared/transaction.ts';
import {createRequire} from 'node:module';
import {createObjectStorage,processParticipantPhoto} from '../packages/storage/src/index.ts';
import {createCoordinatedBackup,restoreCoordinatedBackup,digest} from './lib/backup.ts';
if(process.env.AIA_PHASE4A_SYNTHETIC_REHEARSAL!=='true'||process.env.DEPLOYMENT_ENV!=='staging')throw Error('SYNTHETIC_STAGE_REQUIRED');
const databaseUrl=process.env.DATABASE_URL!,target={environment:'staging' as const,host:'postgres',port:5432,database:'aia_phase4a_stage'},db=createDatabase(databaseUrl);
const storage={endpoint:process.env.MINIO_ENDPOINT!,accessKey:process.env.MINIO_ACCESS_KEY!,secretKey:process.env.MINIO_SECRET_KEY!,region:process.env.MINIO_REGION!,bucket:process.env.MINIO_PHOTOS_BUCKET!};
try {
 const f=await fixture(db);await readyConfiguration(db,f);const source=await readyPerson(db,f,'Synthetic Linux recovery worker',process.env.DOCUMENT_ENCRYPTION_KEY!);
 const sharp=createRequire(new URL('../packages/storage/package.json',import.meta.url))('sharp'),oldStore=createObjectStorage(storage),jpeg=await sharp({create:{width:48,height:48,channels:3,background:'#707070'}}).jpeg().toBuffer();await oldStore.putPhoto(source.photoObjectKey!,jpeg);
 await transaction(db,tx=>recordPrivacyAcknowledgement(tx,{eventId:f.event.id,registrationId:f.registration.id,participantId:source.id,actorType:'ADMIN',actorUserId:f.admin.id,kind:'WORKER',version:'test-v1',locale:'en'}));
 const historical=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,dataProcessingAccepted:true,dataProcessingNoticeVersion:'test-v1'},process.env.DOCUMENT_ENCRYPTION_KEY!);
 const derivativeKey=source.photoObjectKey+'-adjusted',derivative=await sharp({create:{width:48,height:48,channels:3,background:'#c02030'}}).jpeg().toBuffer();await oldStore.putPhoto(derivativeKey,derivative);await db.submissionPhotoAdjustment.create({data:{submissionId:historical.id,participantId:source.id,adjustedByUserId:f.admin.id,photoObjectKey:derivativeKey}});
 await reviewSubmissionParticipant(db,f.adminActor,{submissionId:historical.id,participantId:source.id,outcome:'APPROVED'});await reviewCompanySubmission(db,f.adminActor,{submissionId:historical.id,expectedRegistrationVersion:2,action:'APPROVE'});
 const archiveKey=await readFile('/run/operator-secrets/archive.key'),custodyKey=await readFile('/run/operator-secrets/custody.key');
 const receipt=await createCoordinatedBackup({databaseUrl,target,storage,destination:'/backups',workDirectory:'/tmp/backup-work',archiveKey,custodyKey,expiresAt:new Date(Date.now()+3600000),recoveryKeys:{DOCUMENT_ENCRYPTION_KEY:process.env.DOCUMENT_ENCRYPTION_KEY!,DOCUMENT_FINGERPRINT_KEY:process.env.DOCUMENT_FINGERPRINT_KEY!,AUTH_EMAIL_ENCRYPTION_KEY:process.env.AUTH_EMAIL_ENCRYPTION_KEY!}});
 const url=new URL(databaseUrl);url.pathname='/aia_phase4a_restore';const restoredStorage={...storage,bucket:'aia-phase4a-restore-'+randomUUID()},options={receiptFile:'/backups/'+receipt.id+'.receipt.json',databaseUrl:url.toString(),target:{...target,database:'aia_phase4a_restore'},storage:restoredStorage,archiveKey,custodyKey,workDirectory:'/tmp/restore-work'};
 const result=await restoreCoordinatedBackup(options),restored=createDatabase(url.toString());
 try {const person=await restored.eventParticipant.findUniqueOrThrow({where:{id:source.id}}),snapshot=await restored.companySubmission.findUniqueOrThrow({where:{id:historical.id}});if(revealDocumentNumber(person,result.recoveryKeys.DOCUMENT_ENCRYPTION_KEY)!==source.id||!isDeepStrictEqual(decryptSubmissionSnapshot(snapshot.snapshot,result.recoveryKeys.DOCUMENT_ENCRYPTION_KEY,snapshot.id),decryptSubmissionSnapshot(historical.snapshot,process.env.DOCUMENT_ENCRYPTION_KEY!,historical.id)))throw Error('RESTORE_DECRYPTION_FAILED');
 const newStore=createObjectStorage(restoredStorage),oldBytes=await oldStore.getPhoto(person.photoObjectKey!),newBytes=await newStore.getPhoto(person.photoObjectKey!);if(digest(oldBytes)!==digest(newBytes)||digest(await newStore.getPhoto(derivativeKey))!==digest(derivative))throw Error('RESTORE_PHOTOGRAPH_MISMATCH');await processParticipantPhoto(newBytes,'image/jpeg');await processParticipantPhoto(await newStore.getPhoto(derivativeKey),'image/jpeg');
 if(await restored.companyEventRegistration.count({where:{id:person.registrationId,status:'APPROVED'}})!==1||await restored.privacyAcknowledgement.count({where:{participantId:person.id}})!==1||(await restored.operationalHeartbeat.findUniqueOrThrow({where:{id:'restore-quarantine'}})).errorCount!==1)throw Error('RESTORE_CONSISTENCY_FAILED');
 let refused=false;try{await restoreCoordinatedBackup(options);}catch{refused=true;}if(!refused)throw Error('NONEMPTY_RESTORE_NOT_REFUSED');
 const evidence={passed:true,synthetic:true,recordDecrypted:true,snapshotDecrypted:true,originalAndAdjustedPhotographsHashAndJPEG:true,registrationAndNoticeConsistent:true,nonemptyRestoreBlocked:true,quarantineMarkerRetained:true,archiveRetained:true,offSiteVerified:false};await writeFile('/backups/restore-rehearsal.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 }finally{await restored.$disconnect();}
}finally{await db.$disconnect();}
