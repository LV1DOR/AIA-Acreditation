import {revealDocumentNumber,decryptSubmissionSnapshot} from "../../packages/domain/src/index.ts";
import {decryptEmail} from "../../packages/email/src/encryption.ts";
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from "node:crypto";
import {createReadStream,createWriteStream} from "node:fs";
import {readFile,writeFile,mkdir,mkdtemp,stat,unlink,readdir,rm} from "node:fs/promises";
import {join,resolve,sep} from "node:path";
import {spawn,execFileSync} from "node:child_process";
import {pipeline} from "node:stream/promises";
import {createDatabase} from "../../packages/database/src/index.ts";
import {createObjectStorage,type StorageOptions} from "../../packages/storage/src/object-storage.ts";
import {validateDatabaseTarget,type Target} from "./targets.ts";
import {syntheticMode} from "../../packages/config/src/deployment-env.ts";

const magic=Buffer.from("AIABKP01"),keyMagic=Buffer.from("AIAKEY01");
export const digest=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
export async function fileDigest(path:string) {const h=createHash("sha256");for await(const b of createReadStream(path))h.update(b);return h.digest("hex");}
function keys(archive:Buffer,custody:Buffer) {if(archive.length!==32||custody.length!==32||archive.equals(custody))throw new Error("DISTINCT_BACKUP_CUSTODY_KEYS_REQUIRED");}
export function sealKeyBundle(data:unknown,key:Buffer,id:string) {const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key,iv);c.setAAD(Buffer.from(id));return Buffer.concat([keyMagic,iv,c.update(JSON.stringify(data)),c.final(),c.getAuthTag()]);}
export function openKeyBundle(data:Buffer,key:Buffer,id:string) {if(!data.subarray(0,8).equals(keyMagic))throw new Error("INVALID_KEY_BUNDLE");const d=createDecipheriv("aes-256-gcm",key,data.subarray(8,20));d.setAAD(Buffer.from(id));d.setAuthTag(data.subarray(-16));return JSON.parse(Buffer.concat([d.update(data.subarray(20,-16)),d.final()]).toString("utf8"));}
async function encryptFile(input:NodeJS.ReadableStream,output:string,key:Buffer,id:string) {const iv=randomBytes(12),c=createCipheriv("aes-256-gcm",key,iv);c.setAAD(Buffer.from(id));await writeFile(output,Buffer.concat([magic,iv]),{mode:0o600,flag:"wx"});await pipeline(input,c,createWriteStream(output,{flags:"a"}));await writeFile(output,c.getAuthTag(),{flag:"a"});}
async function decryptFile(input:string,output:string,key:Buffer,id:string) {const size=(await stat(input)).size;if(size<36)throw new Error("INVALID_BACKUP");const h=await readHeader(input);if(!h.equals(magic))throw new Error("INVALID_BACKUP");const prefix=await readRange(input,8,19),tag=await readRange(input,size-16,size-1);const d=createDecipheriv("aes-256-gcm",key,prefix);d.setAAD(Buffer.from(id));d.setAuthTag(tag);await pipeline(createReadStream(input,{start:20,end:size-17}),d,createWriteStream(output,{mode:0o600,flags:"wx"}));}
async function readRange(path:string,start:number,end:number) {const parts:Buffer[]=[];for await(const p of createReadStream(path,{start,end}))parts.push(Buffer.from(p));return Buffer.concat(parts);}
async function readHeader(path:string){return readRange(path,0,7);}
function databaseTool(name:"pg_dump"|"pg_restore",url:URL,container?:string,extra:string[]=[]) {
  if(container) {
    if(!['127.0.0.1','localhost'].includes(url.hostname)||!["16432","16433"].includes(url.port)||!/^aia-(acreditacao-local-postgres-1|phase3-recovery-test)$/.test(container))throw new Error("ISOLATED_DATABASE_CONTAINER_REQUIRED");
    const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];if(!inspected.NetworkSettings.Ports['5432/tcp']?.some((p:{HostIp:string;HostPort:string})=>p.HostIp==='127.0.0.1'&&p.HostPort===url.port))throw new Error("CONTAINER_DATABASE_PORT_MISMATCH");
    return spawn('docker',['exec',...(name==='pg_restore'?['-i']:[]),container,name,'-U',decodeURIComponent(url.username),'-d',decodeURIComponent(url.pathname.slice(1)),...extra],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  }
  return spawn(name,['-d',decodeURIComponent(url.pathname.slice(1)),...extra],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGSSLMODE:url.searchParams.get('sslmode')??'prefer',PGSSLROOTCERT:url.searchParams.get('sslrootcert')??process.env.PGSSLROOTCERT}});
}
async function completion(child:ReturnType<typeof spawn>) {return new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('BACKUP_TOOL_UNAVAILABLE')));child.stderr?.resume();child.once('exit',code=>code===0?resolve():reject(new Error('BACKUP_TOOL_FAILED')));});}
export type BackupOptions={databaseUrl:string;target:Target;container?:string;storage:StorageOptions;destination:string;workDirectory:string;archiveKey:Buffer;custodyKey:Buffer;expiresAt:Date;recoveryKeys:{DOCUMENT_ENCRYPTION_KEY:string;DOCUMENT_FINGERPRINT_KEY:string;AUTH_EMAIL_ENCRYPTION_KEY:string};};
export async function createCoordinatedBackup(o:BackupOptions) {
  const url=validateDatabaseTarget(o.databaseUrl,o.target);keys(o.archiveKey,o.custodyKey);if(o.expiresAt<=new Date())throw new Error("APPROVED_FUTURE_BACKUP_EXPIRY_REQUIRED");
  if(Object.values(o.recoveryKeys).includes(o.archiveKey.toString("hex"))||Object.values(o.recoveryKeys).includes(o.custodyKey.toString("hex"))||new Set(Object.values(o.recoveryKeys)).size!==3)throw new Error("BACKUP_KEYS_MUST_NOT_REUSE_APPLICATION_KEYS");
  if(Object.values(o.recoveryKeys).some(k=>!/^[a-f0-9]{64}$/i.test(k)))throw new Error("RECOVERY_KEY_MATERIAL_REQUIRED");
  const id=randomUUID(),destination=resolve(o.destination);await mkdir(destination,{recursive:true,mode:0o700});await mkdir(o.workDirectory,{recursive:true,mode:0o700});const work=await mkdtemp(join(resolve(o.workDirectory),'backup-'));
  const db=createDatabase(o.databaseUrl),storage=createObjectStorage(o.storage),archive=join(destination,id+'.aia-backup'),bundle=join(destination,id+'.aia-keys');let ledger=false;
  try {
    // An older schema can be backed up before the Phase 3 ledger migration.
    const exists=await db.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public."BackupRun"') IS NOT NULL AS present`;
    if(exists[0]?.present){await db.backupRun.create({data:{id,status:'CREATING',destination:archive,expiresAt:o.expiresAt}});ledger=true;}
    let manifest:Record<string,unknown>={};
    await db.$transaction(async tx=>{
      const tables=await tx.$queryRaw<{tablename:string}[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
      if(tables.length)await tx.$executeRawUnsafe('LOCK TABLE '+tables.map(t=>'public."'+t.tablename.replaceAll('"','""')+'"').join(',')+' IN SHARE MODE');
      const migrations=await tx.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
      await storage.checkBackupCompatible();
      const people=await tx.eventParticipant.findMany({where:{documentNumberCiphertext:{not:null}}});for(const p of people)revealDocumentNumber(p,o.recoveryKeys.DOCUMENT_ENCRYPTION_KEY);
      const snapshots=await tx.companySubmission.findMany({select:{id:true,snapshot:true}});for(const s of snapshots)decryptSubmissionSnapshot(s.snapshot,o.recoveryKeys.DOCUMENT_ENCRYPTION_KEY,s.id);
      const mail=await tx.outboxMessage.findMany({where:{type:{in:["AUTH_EMAIL","LEADER_INVITATION_EMAIL"]},processedAt:null},select:{id:true,payload:true}});for(const m of mail)if(m.payload&&Object.keys(m.payload).length)decryptEmail(m.payload,o.recoveryKeys.AUTH_EMAIL_ENCRYPTION_KEY,m.id);
      const listed=await storage.listObjects('',100000);if(listed.truncated)throw new Error('BACKUP_OBJECT_LIMIT_EXCEEDED');
      const command=databaseTool('pg_dump',url,o.container,['--format=custom','--no-owner','--no-acl']);const done=completion(command);await pipeline(command.stdout!,createWriteStream(join(work,'database.dump'),{mode:0o600}));await done;
      await mkdir(join(work,'objects'),{mode:0o700});const objects=[];
      for(const x of listed.objects) {if(x.size>16*1024*1024)throw new Error('BACKUP_OBJECT_SIZE_LIMIT');const bytes=await storage.getPhoto(x.key),filename=digest(x.key);await writeFile(join(work,'objects',filename),bytes,{mode:0o600});objects.push({key:x.key,file:filename,size:bytes.length,sha256:digest(bytes)});}
      const after=await storage.listObjects('',100000);if(after.truncated||JSON.stringify(after.objects)!==JSON.stringify(listed.objects))throw new Error('OBJECTS_CHANGED_DURING_BACKUP');
      manifest={format:1,id,target:o.target,bucket:o.storage.bucket,createdAt:new Date().toISOString(),expiresAt:o.expiresAt.toISOString(),migrationHash:digest(JSON.stringify(migrations)),migrations,documentKeyVersions:[1],snapshotEnvelopeVersions:[1],databaseHash:await fileDigest(join(work,'database.dump')),objects,offSiteVerified:false,configuration:{APP_ORIGIN:process.env.APP_ORIGIN??null,EMAIL_PROVIDER:process.env.EMAIL_PROVIDER??'smtp',MINIO_REGION:o.storage.region,MINIO_PHOTOS_BUCKET:o.storage.bucket,DEPLOYMENT_ENV:o.target.environment,secretValuesExcluded:true}};
      await writeFile(join(work,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
      const tar=spawn('tar',['-czf','-','-C',work,'database.dump','manifest.json','objects'],{windowsHide:true,stdio:['ignore','pipe','pipe']});const tarDone=completion(tar);await encryptFile(tar.stdout!,archive,o.archiveKey,id);await tarDone;
    },{isolationLevel:'RepeatableRead',timeout:600000});
    await writeFile(bundle,sealKeyBundle({format:1,keyVersions:[1],...o.recoveryKeys},o.custodyKey,id),{mode:0o600,flag:'wx'});
    const receipt={...manifest,id,archive,archiveHash:await fileDigest(archive),keyBundle:bundle,keyBundleHash:await fileDigest(bundle),verifiedAt:new Date().toISOString()};
    // Verify authenticated ciphertext before issuing a receipt.
    await decryptFile(archive,join(work,'verify.tar.gz'),o.archiveKey,id);openKeyBundle(await readFile(bundle),o.custodyKey,id);
    await writeFile(join(destination,id+'.receipt.json'),JSON.stringify(receipt),{mode:0o600});
    if(ledger)await db.backupRun.update({where:{id},data:{status:'VERIFIED',archiveHash:receipt.archiveHash,keyBundleHash:receipt.keyBundleHash,migrationHash:String(manifest.migrationHash),verifiedAt:new Date()}});
    return receipt;
  }catch{if(ledger)await db.backupRun.update({where:{id},data:{status:'FAILED',lastFailureCode:'COORDINATED_BACKUP_FAILED'}}).catch(()=>{});throw new Error('COORDINATED_BACKUP_FAILED');}
  finally{await db.$disconnect();await cleanupPrivateWork(work,o.workDirectory);}
}
export async function verifyBackupReceipt(receiptFile:string,target:Target) {
  const r=JSON.parse(await readFile(receiptFile,'utf8'));
  if(JSON.stringify(r.target)!==JSON.stringify(target)||!r.verifiedAt||await fileDigest(r.archive)!==r.archiveHash||await fileDigest(r.keyBundle)!==r.keyBundleHash||!(await readHeader(r.archive)).equals(magic))throw new Error('VERIFIED_TARGET_BACKUP_REQUIRED');
  return r;
}
export async function restoreCoordinatedBackup(o:{receiptFile:string;databaseUrl:string;target:Target;container?:string;storage:StorageOptions;archiveKey:Buffer;custodyKey:Buffer;workDirectory:string;}) {
  const url=validateDatabaseTarget(o.databaseUrl,o.target);
  const phase3=o.target.environment==='test'&&url.port==='16433'&&o.target.database==='aia_phase3_restore'&&o.storage.bucket.startsWith('aia-phase3-restore-');
  const phase4=o.target.environment==='staging'&&url.hostname==='postgres'&&url.port==='5432'&&o.target.database==='aia_phase4a_restore'&&o.storage.bucket.startsWith('aia-phase4a-restore-')&&process.env.AIA_PHASE4A_SYNTHETIC_REHEARSAL==='true'&&syntheticMode();
  if(!phase3&&!phase4)throw new Error('CLEAN_ISOLATED_RESTORE_REQUIRED');keys(o.archiveKey,o.custodyKey);
  const receipt=JSON.parse(await readFile(o.receiptFile,'utf8'));if(await fileDigest(receipt.archive)!==receipt.archiveHash||await fileDigest(receipt.keyBundle)!==receipt.keyBundleHash)throw new Error('BACKUP_INTEGRITY_FAILED');
  const recoveryKeys=openKeyBundle(await readFile(receipt.keyBundle),o.custodyKey,receipt.id);await mkdir(o.workDirectory,{recursive:true,mode:0o700});const work=await mkdtemp(join(resolve(o.workDirectory),'restore-')),db=createDatabase(o.databaseUrl),storage=createObjectStorage(o.storage);
  try {
    if(phase4){const marker=await db.$queryRaw<{marker:string|null}[]>`SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;if(marker[0]?.marker!=='aia-phase4a-synthetic-only')throw new Error('SYNTHETIC_RESTORE_MARKER_REQUIRED');}
    const tables=await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_tables WHERE schemaname='public'`;if(Number(tables[0]?.count))throw new Error('RESTORE_DATABASE_NOT_EMPTY');
    await storage.ensureBucket();if((await storage.listObjects('',1)).objects.length)throw new Error('RESTORE_BUCKET_NOT_EMPTY');
    await decryptFile(receipt.archive,join(work,'archive.tar.gz'),o.archiveKey,receipt.id);
    const entries=execFileSync('tar',['-tzf',join(work,'archive.tar.gz')],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);if(entries.some(e=>!['database.dump','manifest.json','objects','objects/'].includes(e)&&!/^objects\/[a-f0-9]{64}$/.test(e)))throw new Error('UNSAFE_BACKUP_ARCHIVE');
    execFileSync('tar',['-xzf',join(work,'archive.tar.gz'),'-C',work],{stdio:'ignore'});
    const manifest=JSON.parse(await readFile(join(work,'manifest.json'),'utf8'));if(manifest.id!==receipt.id||await fileDigest(join(work,'database.dump'))!==manifest.databaseHash)throw new Error('DATABASE_BACKUP_INTEGRITY_FAILED');
    const command=databaseTool('pg_restore',url,o.container,['--exit-on-error','--no-owner','--no-privileges']);const done=completion(command);await pipeline(createReadStream(join(work,'database.dump')),command.stdin!);command.stdout!.resume();await done;
    await db.operationalHeartbeat.upsert({where:{id:"restore-quarantine"},create:{id:"restore-quarantine",lastSeenAt:new Date(),errorCount:1},update:{lastSeenAt:new Date(),errorCount:1}});
    for(const object of manifest.objects){if(!/^[a-f0-9]{64}$/.test(object.file)||await fileDigest(join(work,'objects',object.file))!==object.sha256)throw new Error('OBJECT_BACKUP_INTEGRITY_FAILED');const bytes=await readFile(join(work,'objects',object.file));await storage.putPhoto(object.key,bytes);if(digest(await storage.getPhoto(object.key))!==object.sha256)throw new Error('RESTORED_OBJECT_INTEGRITY_FAILED');}
    const migrations=await db.$queryRaw<{migration_name:string;checksum:string}[]>`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;if(digest(JSON.stringify(migrations))!==manifest.migrationHash)throw new Error('RESTORE_MIGRATION_MISMATCH');
    await db.operationalHeartbeat.upsert({where:{id:"restore-quarantine"},create:{id:"restore-quarantine",lastSeenAt:new Date(),errorCount:1},update:{lastSeenAt:new Date(),errorCount:1}});
    const migrationSql=await readFile('packages/database/prisma/migrations/20261014000100_privacy_recovery/migration.sql','utf8');const grants=migrationSql.slice(migrationSql.indexOf('ALTER FUNCTION execute_privacy_erasure(uuid) OWNER'));await db.$executeRawUnsafe(grants);await db.$executeRawUnsafe('GRANT SELECT ON "Company" TO aia_privacy_owner');
    if(manifest.migrations.some((m:{migration_name:string})=>m.migration_name==="20261014000400_erasure_evidence_expiry")){const sql=await readFile("packages/database/prisma/migrations/20261014000400_erasure_evidence_expiry/migration.sql","utf8");await db.$executeRawUnsafe(sql.slice(sql.indexOf("ALTER FUNCTION purge_privacy_operation_evidence(uuid) OWNER")));}
    await db.$executeRawUnsafe('GRANT SELECT ON "BackupRun" TO aia_privacy_owner');
    const erasures=await db.privacyErasureJob.count();return {manifest,recoveryKeys,requiresErasureReconciliation:erasures>0,quarantined:true};
  }finally{await db.$disconnect();await cleanupPrivateWork(work,o.workDirectory);}
}
export async function deleteExpiredLocalBackup(db:ReturnType<typeof createDatabase>,id:string,root:string,now=new Date()) {
  const row=await db.backupRun.findUniqueOrThrow({where:{id}});if(row.expiresAt>now)throw new Error('BACKUP_RETENTION_NOT_REACHED');const archive=resolve(row.destination),base=resolve(root);
  const allowed=resolve(base,id+'.aia-backup');if(archive!==allowed)throw new Error('BACKUP_DESTINATION_SCOPE_MISMATCH');
  for(const suffix of ['.aia-backup','.aia-keys','.receipt.json'])await unlink(join(base,id+suffix)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if((await readdir(base)).some(f=>f.startsWith(id+'.')))throw new Error('BACKUP_COPY_REMAINS');await db.backupRun.update({where:{id},data:{status:'DELETED',deletedAt:now}});
}

async function cleanupPrivateWork(work:string,root:string){if(!resolve(work).startsWith(resolve(root)+sep))throw new Error("BACKUP_WORK_DIRECTORY_SCOPE_MISMATCH");await rm(work,{recursive:true,force:true});}
