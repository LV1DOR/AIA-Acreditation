import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(await readFile(new URL('./overlay/packages/domain/src/privacy/communication-cleanup.ts',import.meta.url),'utf8'));
const now=new Date('2026-10-18T12:00:00Z'),old=new Date('2026-09-01T00:00:00Z'),cutoff=new Date('2026-10-01T00:00:00Z'),future=new Date('2026-12-01T00:00:00Z');
const AnyNull=Symbol('AnyNull');
function match(value,query){
 if(query===AnyNull)return value===null||value===undefined;
 if(query===null||typeof query!=='object'||query instanceof Date)return value===query;
 return Object.entries(query).every(([key,q])=>{
  if(key==='AND')return (Array.isArray(q)?q:[q]).every(x=>match(value,x));
  if(key==='OR')return q.some(x=>match(value,x));
  if(key==='NOT')return !match(value,q);
  if(key==='lt')return value<q;
  if(key==='not')return !match(value,q);
  if(key==='in')return q.includes(value);
  if(key==='equals')return JSON.stringify(value)===JSON.stringify(q);
  if(key==='is')return value!=null&&match(value,q);
  return match(value?.[key],q);
 });
}
async function scenario(options={}){
 const calls=[],audit=[];let rawQueries=0;
 const row=(id,extra={})=>({id,eventId:'event-one',registrationId:'registration-one',type:'BUSINESS_EMAIL',createdAt:old,processedAt:old,terminalAt:null,leaseExpiresAt:null,payload:{text:'PRIVATE_TEST_MESSAGE'},recoveryPayload:null,...extra});
 const rows=options.bulk?Array.from({length:150},(_,i)=>row('old-'+i)):[
  row('event-eligible'),row('other-event',{eventId:'event-two',registrationId:'registration-two'}),
  row('active-message',{processedAt:null}),row('leased-message',{leaseExpiresAt:future}),
  row('new-message',{createdAt:new Date('2026-10-10')}),
  row('old-auth',{type:'AUTH_EMAIL',eventId:null,registrationId:null}),
  row('fresh-auth',{type:'AUTH_EMAIL',createdAt:new Date('2026-10-17'),eventId:null,registrationId:null}),
  row('pending-auth',{type:'AUTH_EMAIL',processedAt:null,eventId:null,registrationId:null}),
 ];
 const emails=rows.map(r=>({outboxMessageId:r.id,recipientHash:'PRIVATE_RECIPIENT_HASH',providerMessageId:'PRIVATE_PROVIDER_ID'}));
 const notifications=[{id:'notice-old',eventId:'event-one',createdAt:old},{id:'notice-other',eventId:'event-two',createdAt:old},{id:'notice-new',eventId:'event-one',createdAt:future}];
 const initial=structuredClone(rows);
 const tx={
  operationalHeartbeat:{findUnique:async()=>options.quarantine?{errorCount:1}:null},
  eventRetentionPolicy:{findFirst:async({where})=>options.noPolicy||options.mismatch?null:{id:'approved-policy',eventId:where.eventId,synthetic:true,communicationsEraseAfter:options.futurePolicy?future:cutoff}},
  eventPrivacyHold:{count:async()=>options.hold?1:0},
  companyEventRegistration:{findMany:async()=>[{id:'registration-one'}]},
  notification:{findMany:async({where,take})=>notifications.filter(n=>match(n,where)).slice(0,take),deleteMany:async({where})=>{calls.push('notification.delete');for(let i=notifications.length-1;i>=0;i--)if(match(notifications[i],where))notifications.splice(i,1);}},
  outboxMessage:{findMany:async({where,take})=>rows.filter(r=>match({...r,emailDelivery:emails.find(e=>e.outboxMessageId===r.id)},where)).slice(0,take),updateMany:async({where,data})=>{calls.push('outbox.update');for(const r of rows)if(match(r,where))Object.assign(r,data);}},
  emailDelivery:{updateMany:async({where,data})=>{calls.push('email.update');for(const r of emails)if(match(r,where))Object.assign(r,data);}},
  auditEvent:{create:async({data})=>audit.push(data)},
 };
 const db={...tx,$queryRaw:async(strings,...args)=>{
  rawQueries++;const sql=strings.join('?');
  assert(sql.includes('LIMIT 10'));assert(sql.includes('"EventPrivacyHold"'));assert(sql.includes('"leaseExpiresAt"'));assert(sql.includes('q.synthetic='));
  assert.equal(args[0],true);return options.noPolicy||options.onlyAuth?[]:[{eventId:'event-one'}];
 }};
 const context=vm.createContext({Date,JSON,process:{env:options.auth??{}},console});
 const module=new vm.SourceTextModule(code,{context});
 const dependencies={'node:crypto':{randomUUID:()=> 'synthetic-uuid'},'@aia/database':{Prisma:{AnyNull}},'@aia/config':{syntheticMode:()=>true},'../shared/transaction.ts':{transaction:async(client,work)=>{assert.equal(client,db);return work(tx);}}};
 await module.link(name=>{const values=dependencies[name];assert(values);return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});await module.evaluate();
 assert.equal(module.namespace.COMMUNICATION_CLEANUP_INTERVAL_MS,3600000);
 const result=await module.namespace.cleanupExpiredCommunicationMetadata(db,now);
 assert(!JSON.stringify(audit).includes('PRIVATE'));
 if(options.quarantine){assert.equal(rawQueries,0);assert.equal(calls.length,0);}
 if(options.noPolicy||options.hold||options.futurePolicy||options.mismatch){assert.equal(calls.length,0);assert.equal(result.messages+result.authMessages+result.notifications,0);}
 if(!options.bulk){
  for(const id of ['other-event','active-message','leased-message','new-message','fresh-auth','pending-auth'])assert.deepEqual(rows.find(r=>r.id===id),initial.find(r=>r.id===id),'Must preserve '+id);
 }
 return {result,rows,audit,calls,notifications,run:()=>module.namespace.cleanupExpiredCommunicationMetadata(db,now)};
}
const normal=await scenario();assert.equal(normal.result.notifications,1);assert.equal(normal.result.messages,1);assert.equal(normal.result.authMessages,0);
assert.equal(normal.rows.find(r=>r.id==='event-eligible').lastFailureCode,'RETENTION_EXPIRED');
assert(normal.rows.find(r=>r.id==='old-auth').payload.text);
const auditCount=normal.audit.length;const again=await normal.run();assert.equal(again.messages+again.notifications+again.authMessages,0);assert.equal(normal.audit.length,auditCount);
await scenario({noPolicy:true});await scenario({hold:true});await scenario({futurePolicy:true});await scenario({mismatch:true});await scenario({quarantine:true});
const auth={AUTH_METADATA_ERASE_BEFORE:'2026-10-01T00:00:00Z',AUTH_METADATA_POLICY_REFERENCE:'APPROVED-TEST-POLICY'};
const globals=await scenario({onlyAuth:true,auth});assert.equal(globals.result.authMessages,1);assert.equal(globals.result.messages,0);
await scenario({onlyAuth:true,auth,hold:true});
const invalid=await scenario({onlyAuth:true,auth:{...auth,AUTH_METADATA_ERASE_BEFORE:'not-a-date'}});assert.equal(invalid.calls.length,0);
const futureCutoff=await scenario({onlyAuth:true,auth:{...auth,AUTH_METADATA_ERASE_BEFORE:'2035-01-01'}});assert.equal(futureCutoff.calls.length,0);
const bulk=await scenario({bulk:true});assert.equal(bulk.result.messages,100);assert.equal(bulk.rows.filter(r=>r.lastFailureCode==='RETENTION_EXPIRED').length,100);
console.log('PASS: 12 cleanup scenarios; approved policy only, synthetic scope, pending/new/leased/other-event data preserved, holds, quarantine, valid auth cutoff, bounded batches and idempotence.');
