// Isolated restore adapter. The audited source restore helper remains unchanged and guarded.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {join} from 'node:path';
import {createDatabase} from '../packages/database/src/index.ts';
import {createObjectStorage} from '../packages/storage/src/object-storage.ts';
import {processParticipantPhoto} from '../packages/storage/src/index.ts';
import {revealDocumentNumber} from '../packages/domain/src/participants/identity.ts';
import {decryptSubmissionSnapshot} from '../packages/domain/src/submissions/snapshot-crypto.ts';
import {digest,fileDigest,openKeyBundle} from '../scripts/lib/backup.ts';
import {decryptArchive} from './backup-crypto.mjs';
import {check,safe} from './guard.ts';
const name='aia_accreditation_production_restore',bucket='aia-accreditation-production-restore-photos';
await safe(async()=>{
  check(process.env.DEPLOYMENT_ENV==='local'&&process.env.AIA_RESTORE_CONFIRM==='ISOLATED_PRODUCTION_BACKUP_RESTORE','ISOLATED_RESTORE_INTENT_REQUIRED');
  const id=process.env.AIA_RESTORE_BACKUP_ID;check(id&&/^[a-f0-9-]{36}$/.test(id),'EXACT_BACKUP_ID_REQUIRED');
  const clusterUrl=new URL(process.env.AIA_RESTORE_CLUSTER_URL??''),url=new URL(process.env.AIA_RESTORE_DATABASE_URL??'');
  check(clusterUrl.hostname==='restore-postgres'&&clusterUrl.username==='aia_restore_cluster'&&clusterUrl.pathname==='/postgres'&&url.hostname==='restore-postgres'&&url.pathname==='/'+name&&url.username==='aia_migrator'&&url.searchParams.get('sslmode')==='verify-full','ISOLATED_RESTORE_TARGET_REQUIRED');
  check(process.env.AIA_RESTORE_STORAGE_ENDPOINT==='https://restore-minio:9000','ISOLATED_RESTORE_STORAGE_REQUIRED');
  const receipt=JSON.parse(await readFile('/input/'+id+'.receipt.json','utf8')),archive='/input/'+id+'.aia-backup',bundle='/input/'+id+'.aia-keys';
  check(receipt.id===id&&receipt.target.environment==='production'&&receipt.target.database==='aia_accreditation_production','PRODUCTION_BACKUP_RECEIPT_REQUIRED');
  check(await fileDigest(archive)===receipt.archiveHash&&await fileDigest(bundle)===receipt.keyBundleHash,'BACKUP_CIPHERTEXT_INTEGRITY_FAILED');
  const keys=openKeyBundle(await readFile(bundle),await readFile('/run/secrets/custody_key'),id),archiveKey=await readFile('/run/secrets/archive_key');
  const root=createDatabase(clusterUrl.toString());let db:ReturnType<typeof createDatabase>|undefined;
  await mkdir('/restore-work',{mode:0o700,recursive:true});const work=await mkdtemp('/restore-work/run-');
  const storage=createObjectStorage({endpoint:'https://restore-minio:9000',region:'us-east-1',bucket,accessKey:process.env.AIA_RESTORE_MINIO_USER!,secretKey:process.env.AIA_RESTORE_MINIO_PASSWORD!});
  try{
    // Authenticate ciphertext and validate the archive before creating any restore database.
    await decryptArchive(archive,join(work,'archive.tar.gz'),archiveKey,id);
    const entries=execFileSync('tar',['-tzf',join(work,'archive.tar.gz')],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
    check(entries.every(e=>['database.dump','manifest.json','objects/','objects'].includes(e)||/^objects\/[a-f0-9]{64}$/.test(e)),'UNSAFE_RESTORE_ARCHIVE');
    const types=execFileSync('tar',['-tvzf',join(work,'archive.tar.gz')],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
    check(types.every(e=>e.startsWith('-')||e.startsWith('d')),'RESTORE_ARCHIVE_LINK_OR_SPECIAL_FILE_FORBIDDEN');
    execFileSync('tar',['-xzf',join(work,'archive.tar.gz'),'--no-same-owner','--no-same-permissions','-C',work],{stdio:'ignore'});
    const manifest=JSON.parse(await readFile(join(work,'manifest.json'),'utf8'));
    check(manifest.id===id&&await fileDigest(join(work,'database.dump'))===manifest.databaseHash&&['7227a412c854c076fd4df178135bbd116be1cdcf9553e388333579709172308e','1d0b0c47b81a6aa89a302b12a2b1680d52e0617bde922c5ea662206ba5406343','debe402c7cd85914213a0c02f45f084d34d2abdea91467e7d5cc6941dabd94ad','3357a0ac5c73d43dfba4df9ecdd043be0d92ea085c6080413dcc6edf2ab13872','958e4b864a7f6d06b578518e09a11798d00e23df8cb08896e29f08636b41f369','0e948440410cfa7a17f0a9b7b3f641326df3685cd570a561231638c7463b1053'].includes(manifest.configuration?.material),'RESTORE_MANIFEST_OR_RELEASE_MISMATCH');
    const existing=await root.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')`;
    check(existing.length===0,'RESTORE_CLUSTER_MUST_BE_NEW_EMPTY');
    for(const role of ['aia_privacy_owner','aia_privacy_executor','aia_runtime','aia_backup'])await root.$executeRawUnsafe('CREATE ROLE '+role+' NOLOGIN');
    const p=decodeURIComponent(url.password);check(/^[a-f0-9]{64}$/.test(p),'FRESH_RESTORE_PASSWORD_REQUIRED');
    await root.$executeRawUnsafe("CREATE ROLE aia_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+p+"'");
    await root.$executeRawUnsafe('GRANT aia_privacy_owner TO aia_migrator');await root.$executeRawUnsafe('CREATE DATABASE '+name+' OWNER aia_migrator');
    await root.$executeRawUnsafe("COMMENT ON DATABASE "+name+" IS 'aia-accreditation-production-restore-quarantined'");
    db=createDatabase(url.toString());
    await storage.ensureBucket();check(!(await storage.listObjects('',1)).objects.length,'RESTORE_BUCKET_MUST_BE_EMPTY');
    await storage.checkBackupCompatible();
    const pg=spawn('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--dbname',name],{env:{...process.env,PGHOST:url.hostname,PGPORT:'5432',PGUSER:'aia_migrator',PGPASSWORD:p,PGSSLMODE:'verify-full',PGSSLROOTCERT:'/run/secrets/ca_cert'},stdio:['pipe','ignore','pipe']});
    const completed=new Promise<void>((ok,no)=>{pg.stderr?.resume();pg.once('error',()=>no(Error('RESTORE_DATABASE_TOOL_FAILED')));pg.once('close',n=>n===0?ok():no(Error('RESTORE_DATABASE_TOOL_FAILED')));});
    await Promise.all([pipeline(createReadStream(join(work,'database.dump')),pg.stdin!),completed]);
    await db.operationalHeartbeat.upsert({where:{id:'restore-quarantine'},create:{id:'restore-quarantine',lastSeenAt:new Date(),errorCount:1},update:{lastSeenAt:new Date(),errorCount:1}});
    for(const x of manifest.objects){check(/^[a-f0-9]{64}$/.test(x.file)&&await fileDigest(join(work,'objects',x.file))===x.sha256,'RESTORE_OBJECT_FILE_INTEGRITY_FAILED');const bytes=await readFile(join(work,'objects',x.file));await storage.putPhoto(x.key,bytes);check(digest(await storage.getPhoto(x.key))===x.sha256,'RESTORE_OBJECT_READBACK_FAILED');}
    const history=await db.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    check(digest(JSON.stringify(history))===manifest.migrationHash,'RESTORED_MIGRATION_HISTORY_MISMATCH');
    let decryptedPeople=0,decryptedSnapshots=0;
    const people=await db.eventParticipant.findMany({where:{documentNumberCiphertext:{not:null}}});
    for(const p of people){revealDocumentNumber(p,keys.DOCUMENT_ENCRYPTION_KEY);decryptedPeople++;if(p.photoObjectKey)await processParticipantPhoto(await storage.getPhoto(p.photoObjectKey),'image/jpeg');}
    for(const s of await db.companySubmission.findMany({select:{id:true,snapshot:true}})){decryptSubmissionSnapshot(s.snapshot,keys.DOCUMENT_ENCRYPTION_KEY,s.id);decryptedSnapshots++;}
    const adminUrl=new URL(clusterUrl);adminUrl.pathname='/'+name;const privileged=createDatabase(adminUrl.toString());
    try{
      await privileged.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
      await privileged.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO aia_privacy_owner,aia_privacy_executor');
      for(const [file,marker]of [['20261014000100_privacy_recovery','ALTER FUNCTION execute_privacy_erasure(uuid) OWNER'],['20261014000400_erasure_evidence_expiry','ALTER FUNCTION purge_privacy_operation_evidence(uuid) OWNER']]){
        const sql=await readFile('/app/packages/database/prisma/migrations/'+file+'/migration.sql','utf8');check(sql.includes(marker),'RESTORE_FUNCTION_OWNER_REVIEW_REQUIRED');await privileged.$executeRawUnsafe(sql.slice(sql.indexOf(marker)));
      }
      await privileged.$executeRawUnsafe('GRANT SELECT ON "Company","BackupRun" TO aia_privacy_owner');await privileged.$executeRawUnsafe(await readFile('/app/infra/production/runtime-roles.sql','utf8'));
    }finally{await privileged.$disconnect();}
    const result={passed:true,project:'aia-accreditation-production-restore',backupId:id,objectsVerified:manifest.objects.length,decryptedPeople,decryptedSnapshots,auditRows:await db.auditEvent.count(),privacyAcknowledgements:await db.privacyAcknowledgement.count(),quarantined:true,mailEnabled:false,applicationStarted:false,erasureReconciliationRequired:true};
    await writeFile('/evidence/restore-'+id+'.json',JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
  }finally{await db?.$disconnect();await root.$disconnect();await rm(work,{recursive:true,force:true});}
});
