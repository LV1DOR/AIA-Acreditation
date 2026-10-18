// VPS adapter of reviewed scripts/phase4a-bootstrap.ts. Only one new staging DB.
import {readFile} from 'node:fs/promises';
import {createDatabase} from '../packages/database/src/index.ts';
const project=process.env.AIA_STAGE_PROJECT;
if(process.env.AIA_SYNTHETIC_DATA!=='true'||project!=='aia-accreditation-staging'||process.env.DEPLOYMENT_ENV!=='staging')throw Error('ISOLATED_SYNTHETIC_STACK_REQUIRED');
const cluster=process.env.AIA_CLUSTER_DATABASE_URL!,url=new URL(cluster);if(url.hostname!=='postgres'||url.port!=='5432'||url.pathname!=='/postgres'||url.username!=='aia_cluster_admin')throw Error('STAGING_CLUSTER_IDENTITY_MISMATCH');
const admin=createDatabase(cluster),action=process.argv[2]??'init';
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
try {
 if(action==='init') {
  const storage=JSON.parse(await readFile('/backups/storage-check.json','utf8'));if(storage.project!=='aia-accreditation-staging'||storage.synthetic!==true||storage.passed!==true)throw Error('PASSED_STORAGE_CAPABILITY_TEST_REQUIRED');
  const rows=await admin.$queryRaw<{datname:string}[]>`SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')`;
  if(rows.length)throw Error('BOOTSTRAP_REQUIRES_NEW_EMPTY_CLUSTER');
  for(const role of ['aia_privacy_owner','aia_privacy_executor','aia_runtime','aia_backup'])await admin.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
  for(const [role,key]of [['aia_migrator','MIGRATOR'],['aia_web','WEB'],['aia_worker','WORKER'],['aia_erasure','ERASURE']]){const password=process.env['AIA_STAGE_'+key+'_PASSWORD'];if(!password||!/^[a-f0-9]{64}$/.test(password))throw Error('SYNTHETIC_ROLE_PASSWORD_REQUIRED');await admin.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(password)}`);}
  await admin.$executeRawUnsafe("ALTER ROLE aia_migrator SET lock_timeout='5s'");await admin.$executeRawUnsafe("ALTER ROLE aia_migrator SET statement_timeout='10min'");
  await admin.$executeRawUnsafe('GRANT aia_privacy_owner TO aia_migrator');await admin.$executeRawUnsafe('GRANT aia_privacy_executor TO aia_erasure');
  for(const name of ['aia_accreditation_staging']){await admin.$executeRawUnsafe(`CREATE DATABASE ${name} OWNER ${'aia_migrator'}`);await admin.$executeRawUnsafe(`COMMENT ON DATABASE ${name} IS 'aia-accreditation-staging-synthetic-only'`);const u=new URL(cluster);u.pathname='/'+name;const db=createDatabase(u.toString());try{await db.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');await db.$executeRawUnsafe('GRANT USAGE,CREATE ON SCHEMA public TO aia_privacy_owner');}finally{await db.$disconnect();}}
 }else if(action==='grants') {
  const target=new URL(process.env.DATABASE_URL!);if(target.hostname!=='postgres'||target.pathname!=='/aia_accreditation_staging'||target.username!=='aia_migrator')throw Error('STAGING_TARGET_REQUIRED');
  const verify=createDatabase(process.env.DATABASE_URL!);try{const rows=await verify.$queryRawUnsafe<{marker:string}[]>("SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()");if(rows[0]?.marker!=='aia-accreditation-staging-synthetic-only')throw Error('SYNTHETIC_DATABASE_MARKER_REQUIRED');}finally{await verify.$disconnect();}
  const db=createDatabase(process.env.DATABASE_URL!);try{await db.$executeRawUnsafe(await readFile('infra/production/runtime-roles.sql','utf8'));}finally{await db.$disconnect();}
  const u=new URL(cluster);u.pathname='/aia_accreditation_staging';const dbAdmin=createDatabase(u.toString());try{await dbAdmin.$executeRawUnsafe('GRANT aia_runtime TO aia_web,aia_worker');await dbAdmin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO aia_erasure');await dbAdmin.$executeRawUnsafe('REVOKE CREATE ON SCHEMA public FROM aia_privacy_owner');}finally{await dbAdmin.$disconnect();}
 }else throw Error('UNKNOWN_BOOTSTRAP_ACTION');
 console.log(JSON.stringify({passed:true,synthetic:true,action}));
}catch{console.error('STAGING_BOOTSTRAP_FAILED_INSPECT_STATE_DO_NOT_RESET');process.exitCode=1;}finally{await admin.$disconnect();}
