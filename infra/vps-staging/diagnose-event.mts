// Read-only staging diagnosis. ESM entrypoint; never call createEvent with a real database.
import {readFile} from 'node:fs/promises';
import {parse} from '/app/node_modules/dotenv/lib/main.js';
import {createEvent} from '/app/packages/domain/src/events/service.ts';
import {createDatabase} from '/app/packages/database/src/index.ts';
import {assertRestrictedDatabaseRuntime} from '/app/packages/domain/src/operations/database-role.ts';

const fields=new Set(['name','slug','startDate','endDate','onboardingOpensAt','onboardingClosesAt','timezone','publicationState']);
const issueCodes=new Set(['invalid_type','too_big','too_small','invalid_format','custom','unrecognized_keys','invalid_value']);
function code(e:any){
 const value=e?.code;
 return ['P2002','P2003','P2010','P2021','P2022','P2024','P2028','P2034','ECONNREFUSED','ETIMEDOUT'].includes(value)?value:'UNKNOWN';
}
export async function inspectEvent(raw:Record<string,string>){
 const name=String(raw.name??'').trim();
 const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||undefined;
 const values={name,slug,startDate:raw.startDate,endDate:raw.endDate,onboardingOpensAt:raw.onboardingOpensAt,onboardingClosesAt:raw.onboardingClosesAt,timezone:'Europe/Lisbon',publicationState:'DRAFT'};
 const report:any={validationPassed:false,issues:[]};
 // createEvent parses before opening its transaction. Abort at that boundary;
 // this fake client has no query methods and is NEVER the real database client.
 const stop=new Error();
 const fake={$transaction:async()=>{throw stop;}};
 try{await createEvent(fake as any,{clerkUserId:'user_readonlydiagnostic',correlationId:'00000000-0000-4000-8000-000000000001'},values as any);}
 catch(e:any){
  if(e===stop)report.validationPassed=true;
  else if(Array.isArray(e?.issues))report.issues=e.issues.map((i:any)=>({field:fields.has(i.path?.[0])?i.path[0]:'dateRange',code:issueCodes.has(i.code)?i.code:'invalid'}));
  else report.validationError=code(e);
 }
 report.eventDateOrderValid=typeof raw.startDate==='string'&&typeof raw.endDate==='string'&&raw.startDate<=raw.endDate;
 report.onboardingDateOrderValid=Number.isFinite(Date.parse(raw.onboardingOpensAt))&&Date.parse(raw.onboardingOpensAt)<Date.parse(raw.onboardingClosesAt);
 report.generatedIdentifierWithinLimit=!slug||slug.length<=100;
 const e=parse(await readFile('/run/operator-secrets/web.env'));
 const u=new URL(e.DATABASE_URL);
 if(e.DEPLOYMENT_ENV!=='staging'||e.AIA_SYNTHETIC_DATA!=='true'||e.AIA_STAGE_PROJECT!=='aia-accreditation-staging'||u.hostname!=='postgres'||u.port!=='5432'||u.pathname!=='/aia_accreditation_staging'||u.username!=='aia_web')throw new Error('TARGET');
 const db=createDatabase(e.DATABASE_URL);
 try{
  report.database=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const guard=await tx.$queryRawUnsafe<any[]>("SELECT current_setting('transaction_read_only') AS readonly, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
   if(guard[0]?.readonly!=='on'||guard[0]?.marker!=='aia-accreditation-staging-synthetic-only')throw new Error('TARGET');
   await assertRestrictedDatabaseRuntime(tx as any);
   const permissions=await tx.$queryRawUnsafe<any[]>(`SELECT has_table_privilege('public."Event"','INSERT') AS event_insert, has_table_privilege('public."AuditEvent"','INSERT') AS audit_insert, has_table_privilege('public."OutboxMessage"','INSERT') AS outbox_insert`);
   const duplicate=slug?Boolean(await tx.event.findUnique({where:{slug},select:{id:true}})):false;
   const admins=await tx.user.count({where:{role:'ADMIN',disabledAt:null}});
   const quarantine=await tx.operationalHeartbeat.findUnique({where:{id:'restore-quarantine'},select:{errorCount:true}});
   return {readOnly:true,matchingIdentifierExists:duplicate,activeAdminExists:admins>0,restoreQuarantineActive:Boolean(quarantine?.errorCount),permissions:permissions[0]};
  },{timeout:10000});
 }catch(error){report.databaseError=code(error);}
 finally{await db.$disconnect();}
 return report;
}
if(process.env.AIA_EVENT_DIAGNOSTIC==='1'){
 try{
  const input=JSON.parse(await readFile('/dev/stdin','utf8'));
  const report=await inspectEvent(input);
  console.log('EVENT_DIAGNOSTIC '+JSON.stringify(report));
 }catch{
  console.log('EVENT_DIAGNOSTIC '+JSON.stringify({diagnosticError:'CHECK_FAILED'}));process.exitCode=1;
 }
}
