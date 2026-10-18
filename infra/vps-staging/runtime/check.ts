import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';
import {parseEnv,parseStorageEnv,inspectAuthEnv} from '../packages/config/src/index.ts';
import {createDatabase} from '../packages/database/src/index.ts';
import {assertRestrictedDatabaseRuntime} from '../packages/domain/src/index.ts';
try {
 if(process.env.DEPLOYMENT_ENV!=='staging'||process.env.AIA_SYNTHETIC_DATA!=='true'||process.env.AIA_STAGE_PROJECT!=='aia-accreditation-staging')throw Error('TARGET');
 for(const role of ['web','worker']) {
  const e=parse(await readFile('/run/operator-secrets/'+role+'.env'));
  parseEnv(e);parseStorageEnv(e);
  if(inspectAuthEnv(e).status!=='READY'||!e.CLERK_SECRET_KEY?.startsWith('sk_test_')||!e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_'))throw Error('AUTH');
  if(e.SMTP_HOST!=='mailpit'||e.SMTP_REQUIRE_TLS!=='true'||e.SMTP_FROM!=='synthetic@example.invalid')throw Error('SMTP');
  const target=new URL(e.DATABASE_URL!);
  if(target.hostname!=='postgres'||target.pathname!=='/aia_accreditation_staging'||target.username!=='aia_'+role)throw Error('DB');
  const db=createDatabase(e.DATABASE_URL!);
  try {
   const marker=await db.$queryRawUnsafe<{marker:string}[]>("SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()");
   if(marker[0]?.marker!=='aia-accreditation-staging-synthetic-only')throw Error('MARKER');
   await assertRestrictedDatabaseRuntime(db);
  } finally {await db.$disconnect();}
 }
 if(process.argv[2]!=='configuration') {
  for(const url of ['http://web:3100/api/health/ready','http://worker:3102/api/health/ready','http://mailpit:8025/api/v1/messages']) {
   const r=await fetch(url,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('READINESS');
  }
 }
 console.log('STAGING_CONFIGURATION_AND_READINESS_PASSED');
} catch {console.error('STAGING_CONFIGURATION_OR_READINESS_FAILED');process.exitCode=1;}
