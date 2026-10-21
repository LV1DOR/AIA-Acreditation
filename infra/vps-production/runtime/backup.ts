// New operator adapter: quiesced writers + read-only dump/storage identity + ledger-only writer.
// Does not relax or call the source backup library's broad SHARE locks.
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createDatabase} from '../packages/database/src/index.ts';
import {createObjectStorage} from '../packages/storage/src/object-storage.ts';
import {parseStorageEnv} from '../packages/config/src/index.ts';
import {revealDocumentNumber} from '../packages/domain/src/participants/identity.ts';
import {decryptSubmissionSnapshot} from '../packages/domain/src/submissions/snapshot-crypto.ts';
import {decryptEmail} from '../packages/email/src/encryption.ts';
import {digest,fileDigest,sealKeyBundle,openKeyBundle} from '../scripts/lib/backup.ts';
import {approvedBackupExpiry} from '../scripts/lib/backup-expiry.ts';
import {encryptArchive,decryptArchive} from './backup-crypto.mjs';
import {check,target,marked,safe,project,bucket,databaseName} from './guard.ts';
const done=(child:ReturnType<typeof spawn>)=>new Promise<void>((ok,no)=>{child.stderr?.resume();child.once('error',()=>no(Error('BACKUP_TOOL_FAILED')));child.once('close',n=>n===0?ok():no(Error('BACKUP_TOOL_FAILED')));});
await safe(async()=>{
  check(process.env.AIA_WRITERS_QUIESCED==='PRODUCTION_WRITERS_STOPPED','WRITER_FREEZE_REQUIRED');
  const url=target(process.env.BACKUP_DATABASE_URL,'aia_backup_reader');target(process.env.AIA_BACKUP_LEDGER_URL,'aia_backup_ledger');
  const s=parseStorageEnv(process.env);check(s.MINIO_PHOTOS_BUCKET===bucket&&s.MINIO_ENDPOINT==='https://minio:9000'&&s.MINIO_ACCESS_KEY==='aia_production_backup','READ_ONLY_BACKUP_STORAGE_REQUIRED');
  const db=createDatabase(process.env.BACKUP_DATABASE_URL!),ledger=createDatabase(process.env.AIA_BACKUP_LEDGER_URL!);
  const storage=createObjectStorage({endpoint:s.MINIO_ENDPOINT,bucket,region:s.MINIO_REGION,accessKey:s.MINIO_ACCESS_KEY,secretKey:s.MINIO_SECRET_KEY});
  const archiveKey=await readFile('/run/secrets/archive_key'),custodyKey=await readFile('/run/secrets/custody_key');
  check(archiveKey.length===32&&custodyKey.length===32&&!archiveKey.equals(custodyKey),'DISTINCT_BACKUP_KEYS_REQUIRED');
  check(![s.DOCUMENT_ENCRYPTION_KEY,s.DOCUMENT_FINGERPRINT_KEY,process.env.AUTH_EMAIL_ENCRYPTION_KEY].includes(archiveKey.toString('hex'))&&![s.DOCUMENT_ENCRYPTION_KEY,s.DOCUMENT_FINGERPRINT_KEY,process.env.AUTH_EMAIL_ENCRYPTION_KEY].includes(custodyKey.toString('hex')),'BACKUP_APPLICATION_KEYS_MUST_DIFFER');
  const id=randomUUID(),expiresAt=approvedBackupExpiry(process.env),archive='/backups/'+id+'.aia-backup',keyBundle='/backups/'+id+'.aia-keys';
  await mkdir('/backups/.work',{mode:0o700,recursive:true});const work=await mkdtemp('/backups/.work/'+id+'-');let registered=false;
  try{
    await marked(db);await marked(ledger);
    const privileges=await db.$queryRaw<{unsafe:boolean}[]>`SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND (has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'INSERT,UPDATE,DELETE,TRUNCATE'))) AS unsafe FROM pg_roles r WHERE rolname=current_user`;
    check(privileges.length===1&&!privileges[0]!.unsafe,'READ_ONLY_BACKUP_DATABASE_REQUIRED');
    await ledger.backupRun.create({data:{id,status:'CREATING',destination:archive,expiresAt}});registered=true;
    await storage.checkReady(true);await storage.checkBackupCompatible();
    const listed=await storage.listObjects('',100000);check(!listed.truncated,'BACKUP_OBJECT_LIMIT_EXCEEDED');
    const disk=await statfs('/backups');check(disk.bavail*disk.bsize>listed.objects.reduce((n,x)=>n+x.size,0)*4+2*1024**3,'BACKUP_WORKSPACE_DISK_HEADROOM_REQUIRED');
    const migrations=await db.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    const people=await db.eventParticipant.findMany({where:{documentNumberCiphertext:{not:null}}});for(const p of people)revealDocumentNumber(p,s.DOCUMENT_ENCRYPTION_KEY);
    const snapshots=await db.companySubmission.findMany({select:{id:true,snapshot:true}});for(const x of snapshots)decryptSubmissionSnapshot(x.snapshot,s.DOCUMENT_ENCRYPTION_KEY,x.id);
    const mail=await db.outboxMessage.findMany({where:{type:{in:['AUTH_EMAIL','LEADER_INVITATION_EMAIL']},processedAt:null},select:{id:true,payload:true}});for(const x of mail)if(x.payload&&Object.keys(x.payload).length)decryptEmail(x.payload,process.env.AUTH_EMAIL_ENCRYPTION_KEY!,x.id);
    const pg=spawn('pg_dump',['--format=custom','--no-owner','--no-acl','--dbname',databaseName],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port,PGUSER:url.username,PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:'verify-full',PGSSLROOTCERT:'/run/secrets/ca_cert'},stdio:['ignore','pipe','pipe']});
    await Promise.all([pipeline(pg.stdout!,createWriteStream(join(work,'database.dump'),{mode:0o600})),done(pg)]);
    await mkdir(join(work,'objects'),{mode:0o700});const objects=[];
    for(const x of listed.objects){check(x.size<=16*1024*1024,'BACKUP_OBJECT_SIZE_LIMIT');const bytes=await storage.getPhoto(x.key),file=digest(x.key);await writeFile(join(work,'objects',file),bytes,{mode:0o600});objects.push({key:x.key,file,size:bytes.length,sha256:digest(bytes)});}
    check(JSON.stringify((await storage.listObjects('',100000)).objects)===JSON.stringify(listed.objects),'STORAGE_CHANGED_DURING_FROZEN_BACKUP');
    const metadata=JSON.parse(await readFile('/run/operator-secrets/recovery-metadata.json','utf8'));
    const manifest={format:1,id,target:{environment:'production',host:'postgres',port:5432,database:databaseName},bucket,createdAt:new Date().toISOString(),expiresAt:expiresAt.toISOString(),migrations,migrationHash:digest(JSON.stringify(migrations)),databaseHash:await fileDigest(join(work,'database.dump')),objects,configuration:metadata,offSiteVerified:false,backupAdapter:'quiesced-readonly-v1'};
    await writeFile(join(work,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
    const tar=spawn('tar',['-czf','-','-C',work,'database.dump','manifest.json','objects'],{stdio:['ignore','pipe','pipe']});await Promise.all([encryptArchive(tar.stdout!,archive,archiveKey,id),done(tar)]);
    const keys={format:1,keyVersions:[1],DOCUMENT_ENCRYPTION_KEY:s.DOCUMENT_ENCRYPTION_KEY,DOCUMENT_FINGERPRINT_KEY:s.DOCUMENT_FINGERPRINT_KEY,AUTH_EMAIL_ENCRYPTION_KEY:process.env.AUTH_EMAIL_ENCRYPTION_KEY};
    await writeFile(keyBundle,sealKeyBundle(keys,custodyKey,id),{mode:0o600,flag:'wx'});
    await decryptArchive(archive,join(work,'verify.tar.gz'),archiveKey,id);openKeyBundle(await readFile(keyBundle),custodyKey,id);
    const receipt={...manifest,archive,keyBundle,archiveHash:await fileDigest(archive),keyBundleHash:await fileDigest(keyBundle),verifiedAt:new Date().toISOString()};
    await writeFile('/backups/'+id+'.receipt.json',JSON.stringify(receipt),{mode:0o600,flag:'wx'});
    await ledger.backupRun.update({where:{id},data:{status:'VERIFIED',archiveHash:receipt.archiveHash,keyBundleHash:receipt.keyBundleHash,migrationHash:manifest.migrationHash,verifiedAt:new Date()}});
    console.log(JSON.stringify({passed:true,id,project,localCiphertextVerified:true,offSiteVerified:false,restoreVerified:false}));
  }catch{if(registered)await ledger.backupRun.update({where:{id},data:{status:'FAILED',lastFailureCode:'QUIESCED_BACKUP_FAILED'}}).catch(()=>{});throw Error('QUIESCED_BACKUP_FAILED');}
  finally{await db.$disconnect();await ledger.$disconnect();await rm(work,{recursive:true,force:true});}
});
