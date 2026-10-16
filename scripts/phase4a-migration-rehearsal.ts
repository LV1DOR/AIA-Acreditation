import {mkdir,mkdtemp,readFile,readdir,writeFile,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createDatabase} from '../packages/database/src/index.ts';
import {isDeepStrictEqual} from 'node:util';
if(process.env.AIA_PHASE4A_SYNTHETIC_REHEARSAL!=='true'||process.env.DEPLOYMENT_ENV!=='staging')throw Error('SYNTHETIC_STAGE_REQUIRED');
const u=new URL(process.env.AIA_CLUSTER_DATABASE_URL!);if(u.hostname!=='postgres'||u.pathname!=='/postgres')throw Error('STAGE_IDENTITY_REQUIRED');u.pathname='/aia_phase4a_legacy';const db=createDatabase(u.toString());
const base='/app/packages/database/prisma/migrations',names=(await readdir(base)).filter(n=>/^\d/.test(n)).sort(),tmp=await mkdtemp('/tmp/aia-migrations-');
const deploy=(config:string,expected=0)=>{const p=spawnSync(process.execPath,['/app/packages/database/node_modules/prisma/build/index.js','migrate','deploy','--config',config],{env:{...process.env,PHASE4A_DATABASE_URL:u.toString()},encoding:'utf8'});if(p.status!==expected)throw Error('MIGRATION_REHEARSAL_COMMAND_FAILED');return p;};
const writeConfig=async(dir:string)=>{const config=dir+'/config.ts';await writeFile(config,`export default {schema:'/app/packages/database/prisma/schema.prisma',migrations:{path:${JSON.stringify(dir+'/migrations')}},datasource:{url:process.env.PHASE4A_DATABASE_URL}};`);return config;};
try {
 if((await db.$queryRaw<{n:bigint}[]>`SELECT count(*) n FROM pg_tables WHERE schemaname='public'`)[0]!.n!==0n)throw Error('LEGACY_REHEARSAL_REQUIRES_EMPTY_DATABASE');
 await mkdir(tmp+'/migrations');await copyFile(base+'/migration_lock.toml',tmp+'/migrations/migration_lock.toml');
 for(const n of names.slice(0,14)){await mkdir(tmp+'/migrations/'+n);await copyFile(base+'/'+n+'/migration.sql',tmp+'/migrations/'+n+'/migration.sql');}
 const config=await writeConfig(tmp);deploy(config);
 const [company,event,registration,person,actor,submission]=Array.from({length:6},()=>randomUUID()),legacyKey=`photos/${event}/${person}/profile.jpg`,snapshot={schemaVersion:1,participants:[{id:person,photoObjectKey:legacyKey}],synthetic:true};
 await db.$executeRaw`INSERT INTO "User"(id,"clerkUserId",role,"updatedAt") VALUES(${actor}::uuid,${'synthetic-legacy-'+actor},'ADMIN',now())`;
 await db.$executeRaw`INSERT INTO "Company"(id,name,"updatedAt") VALUES(${company}::uuid,'Synthetic legacy company',now())`;
 await db.$executeRaw`INSERT INTO "Event"(id,name,"startDate","endDate","onboardingOpensAt","onboardingClosesAt","updatedAt") VALUES(${event}::uuid,'Synthetic legacy event','2030-01-01','2030-01-02',now(),now()+interval '1 day',now())`;
 await db.$executeRaw`INSERT INTO "CompanyEventRegistration"(id,"eventId","companyId","updatedAt") VALUES(${registration}::uuid,${event}::uuid,${company}::uuid,now())`;
 await db.$executeRaw`INSERT INTO "EventParticipant"(id,"registrationId","eventId","fullName","photoObjectKey","updatedAt") VALUES(${person}::uuid,${registration}::uuid,${event}::uuid,'Synthetic legacy worker',${legacyKey},now())`;
 await db.$executeRaw`INSERT INTO "CompanySubmission"(id,"registrationId",version,"registrationVersion",snapshot,"contentHash","submittedByUserId") VALUES(${submission}::uuid,${registration}::uuid,1,1,${JSON.stringify(snapshot)}::jsonb,${'a'.repeat(64)},${actor}::uuid)`;
 for(const n of names.slice(14)){await mkdir(tmp+'/migrations/'+n);await copyFile(base+'/'+n+'/migration.sql',tmp+'/migrations/'+n+'/migration.sql');}
 deploy(config);const count=await db.$queryRaw<{n:bigint}[]>`SELECT count(*) n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;deploy(config);
 const p=await db.eventParticipant.findUniqueOrThrow({where:{id:person}}),s=await db.companySubmission.findUniqueOrThrow({where:{id:submission}});if(p.photoObjectKey!==legacyKey||!isDeepStrictEqual(s.snapshot,snapshot)||count[0]!.n!==BigInt(names.length))throw Error('LEGACY_DATA_COMPATIBILITY_FAILED');
 const inventory=[];for(const n of names){const sql=await readFile(base+'/'+n+'/migration.sql','utf8');inventory.push({name:n,sha256:createHash('sha256').update(sql).digest('hex'),dropsData:/\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA)|TRUNCATE)\b/i.test(sql),changesExistingRows:/\b(?:UPDATE|DELETE FROM)\b/i.test(sql),constraints:(sql.match(/ADD CONSTRAINT|CREATE UNIQUE INDEX/g)??[]).length,hasImmutabilityOrPrivacyFunction:/CREATE (?:OR REPLACE )?FUNCTION/i.test(sql),lockReview:'DDL takes relation locks; role lock/statement timeouts and maintenance window required'});}
 // A deliberately invalid migration fails without deleting baseline data. Never
 // resolve a failed production migration automatically. This database remains evidence.
 const bad='20990101000100_synthetic_failure';await mkdir(tmp+'/migrations/'+bad);await writeFile(tmp+'/migrations/'+bad+'/migration.sql','CREATE TABLE "Phase4ASyntheticFailure" (id integer); SELECT definitely_invalid_phase4a();');
 const failure=spawnSync(process.execPath,['/app/packages/database/node_modules/prisma/build/index.js','migrate','deploy','--config',config],{env:{...process.env,PHASE4A_DATABASE_URL:u.toString()},stdio:'pipe'});if(failure.status===0||await db.eventParticipant.count({where:{id:person}})!==1)throw Error('FAILED_MIGRATION_BOUNDARY_NOT_PROVEN');
 await writeFile('/backups/migration-rehearsal.json',JSON.stringify({passed:true,synthetic:true,migrations:names.length,baseline:14,idempotentDeploy:true,legacyPhotoKeyPreserved:true,snapshotPreserved:true,failedMigrationDetected:true,failedDatabaseRetained:true,inventory},null,2));console.log(JSON.stringify({passed:true,migrations:names.length,baseline:14,idempotentDeploy:true,failedMigrationDetected:true}));
}finally{await db.$disconnect();}
