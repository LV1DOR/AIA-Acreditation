import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createDatabase} from '../packages/database/src/index.ts';
const project=process.env.AIA_STAGE_PROJECT;
if(process.env.AIA_PHASE4A_SYNTHETIC_REHEARSAL!=='true'||!project?.startsWith('aia-accreditation-phase4a-')||process.env.DEPLOYMENT_ENV!=='staging')throw Error('ISOLATED_SYNTHETIC_STACK_REQUIRED');
const cluster=process.env.AIA_CLUSTER_DATABASE_URL!,url=new URL(cluster);if(url.hostname!=='postgres'||url.port!=='5432'||url.pathname!=='/postgres'||url.username!=='aia_cluster_admin')throw Error('STAGING_CLUSTER_IDENTITY_MISMATCH');
const admin=createDatabase(cluster),action=process.argv[2]??'init';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
try {
 if(action==='init') {
  const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')`;
  if(rows.length)throw Error('BOOTSTRAP_REQUIRES_NEW_EMPTY_CLUSTER');
  for(const role of ['aia_privacy_owner','aia_privacy_executor','aia_runtime','aia_backup'])await admin.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
  for(const [role,key]of [['aia_migrator','MIGRATOR'],['aia_web','WEB'],['aia_worker','WORKER'],['aia_erasure','ERASURE']]){const password=process.env['AIA_STAGE_'+key+'_PASSWORD'];if(!password||!/^[a-f0-9]{64}$/.test(password))throw Error('SYNTHETIC_ROLE_PASSWORD_REQUIRED');await admin.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(password)}`);}
  await admin.$executeRawUnsafe('GRANT aia_privacy_owner TO aia_migrator');await admin.$executeRawUnsafe('GRANT aia_privacy_executor TO aia_erasure');
  for(const name of ['aia_phase4a_stage','aia_phase4a_legacy','aia_phase4a_restore','aia_acreditacao_test']){await admin.$executeRawUnsafe(`CREATE DATABASE ${name} OWNER ${name==='aia_acreditacao_test'?'aia_cluster_admin':'aia_migrator'}`);await admin.$executeRawUnsafe(`COMMENT ON DATABASE ${name} IS 'aia-phase4a-synthetic-only'`);const u=new URL(cluster);u.pathname='/'+name;const db=createDatabase(u.toString());try{await db.$executeRawUnsafe('GRANT USAGE,CREATE ON SCHEMA public TO aia_privacy_owner');}finally{await db.$disconnect();}}
  await mkdir('/tmp/mc',{recursive:true});await mkdir('/tmp/mc/certs/CAs',{recursive:true});await copyFile('/run/secrets/ca_cert','/tmp/mc/certs/CAs/ca.crt');
  const mc=(args:string[])=>{const p=spawnSync('mc',['--config-dir','/tmp/mc',...args],{env:{...process.env,SSL_CERT_FILE:'/run/secrets/ca_cert'},stdio:'ignore'});if(p.status!==0)throw Error('ISOLATED_STORAGE_BOOTSTRAP_FAILED');};
  mc(['alias','set','stage',process.env.MINIO_ENDPOINT!,process.env.MINIO_ACCESS_KEY!,process.env.MINIO_SECRET_KEY!]);mc(['mb','stage/'+process.env.MINIO_PHOTOS_BUCKET]);
  await writeFile('/tmp/s3-policy.json',JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:['s3:GetBucketLocation','s3:GetBucketVersioning','s3:ListBucket','s3:ListBucketVersions','s3:GetBucketPolicy'],Resource:['arn:aws:s3:::'+process.env.MINIO_PHOTOS_BUCKET]},{Effect:'Allow',Action:['s3:GetObject','s3:PutObject','s3:DeleteObject','s3:DeleteObjectVersion'],Resource:['arn:aws:s3:::'+process.env.MINIO_PHOTOS_BUCKET+'/*']}]}));
  mc(['admin','policy','create','stage','aia-photos','/tmp/s3-policy.json']);
  for(const [name,key]of [['aia_phase4a_web','WEB'],['aia_phase4a_worker','WORKER']]){mc(['admin','user','add','stage',name!,process.env['AIA_STAGE_S3_'+key+'_PASSWORD']!]);mc(['admin','policy','attach','stage','aia-photos','--user',name!]);}
 }else if(action==='grants') {
  const db=createDatabase(process.env.DATABASE_URL!);try{await db.$executeRawUnsafe(await readFile('infra/production/runtime-roles.sql','utf8'));}finally{await db.$disconnect();}
  const u=new URL(cluster);u.pathname='/aia_phase4a_stage';const dbAdmin=createDatabase(u.toString());try{await dbAdmin.$executeRawUnsafe('GRANT aia_runtime TO aia_web,aia_worker');await dbAdmin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO aia_erasure');await dbAdmin.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM aia_privacy_owner');}finally{await dbAdmin.$disconnect();}
 }else throw Error('UNKNOWN_BOOTSTRAP_ACTION');
 console.log(JSON.stringify({passed:true,synthetic:true,action}));
}finally{await admin.$disconnect();}
