// No Docker, real database, network or protected files are accessed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('./diagnose-event.mts',import.meta.url),'utf8'));
async function scenario({invalid=false,duplicate=false,dbError=false}={}){
 const queries=[];let disconnected=false,readOnly=false,dbCount=0,validationCalls=0;
 const context=vm.createContext({URL,Date,Error,process:{env:{}},console:{log:()=>assert.fail('No top-level operation expected')}});
 const tx={
  $executeRawUnsafe:async sql=>{assert.equal(sql,'SET TRANSACTION READ ONLY');assert.equal(queries.length,0);readOnly=true;queries.push(sql);},
  $queryRawUnsafe:async sql=>{
   assert(readOnly);assert(sql.startsWith('SELECT '));queries.push(sql);
   if(sql.includes('current_setting'))return [{readonly:'on',marker:'aia-accreditation-staging-synthetic-only'}];
   if(dbError)throw {code:'P2021',message:'PRIVATE_DATABASE_PAYLOAD'};
   return [{event_insert:true,audit_insert:true,outbox_insert:true}];
  },
  event:{findUnique:async()=>{assert(readOnly);return duplicate?{id:'PRIVATE_ID'}:null;}},
  user:{count:async()=>{assert(readOnly);return 1;}},
  operationalHeartbeat:{findUnique:async()=>{assert(readOnly);return null;}}
 };
 const db={$transaction:async fn=>fn(tx),$disconnect:async()=>{disconnected=true;}};
 const env={DEPLOYMENT_ENV:'staging',AIA_SYNTHETIC_DATA:'true',AIA_STAGE_PROJECT:'aia-accreditation-staging',DATABASE_URL:'postgresql://aia_web:PRIVATE_PASSWORD@postgres:5432/aia_accreditation_staging'};
 function synthetic(values){return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});}
 const module=new vm.SourceTextModule(source,{context});
 await module.link(path=>{
  if(path==='node:fs/promises')return synthetic({readFile:async p=>{assert.equal(p,'/run/operator-secrets/web.env');return JSON.stringify(env);}});
  if(path.includes('dotenv'))return synthetic({parse:JSON.parse});
  if(path.endsWith('/events/service.ts'))return synthetic({createEvent:async(client,_actor,input)=>{
   validationCalls++;assert.notEqual(client,db);assert.equal(Object.keys(client).join(','),'$transaction');
   assert.equal(input.slug,'synthetic-event');
   if(invalid)throw {issues:[{path:['onboardingClosesAt'],code:'invalid_format',message:'PRIVATE_INPUT'},{path:['PRIVATE_PATH'],code:'PRIVATE_CODE'}]};
   return client.$transaction(()=>assert.fail('Validation probe must stop before any transaction work'));
  }});
  if(path.endsWith('/database/src/index.ts'))return synthetic({createDatabase:()=>{dbCount++;return db;}});
  if(path.endsWith('/database-role.ts'))return synthetic({assertRestrictedDatabaseRuntime:async()=>{assert(readOnly);}});
  throw Error('Unexpected fixture import');
 });
 await module.evaluate();assert.equal(dbCount,0);
 const report=await module.namespace.inspectEvent({name:'Synthetic Event',startDate:'2026-11-01',endDate:'2026-11-02',onboardingOpensAt:'2026-10-20T09:00:00Z',onboardingClosesAt:'2026-10-25T18:00:00Z'});
 assert.equal(validationCalls,1);assert.equal(disconnected,true);
 assert(!JSON.stringify(report).includes('PRIVATE'));
 assert.equal(report.validationPassed,!invalid);
 assert.equal(report.eventDateOrderValid,true);assert.equal(report.onboardingDateOrderValid,true);
 if(!dbError){assert.equal(report.database.readOnly,true);assert.equal(report.database.matchingIdentifierExists,duplicate);}
 else assert.equal(report.databaseError,'P2021');
 if(invalid){assert.equal(report.issues[0].field,'onboardingClosesAt');assert.equal(report.issues[1].field,'dateRange');assert.equal(report.issues[1].code,'invalid');}
}
await scenario();await scenario({invalid:true});await scenario({duplicate:true});await scenario({dbError:true});
console.log('PASS: four offline event-diagnostic scenarios; fake-client validation, read-only-before-query enforcement, duplicate check and error redaction.');
