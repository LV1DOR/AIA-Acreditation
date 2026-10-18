// Offline execution of the reviewed domain and server action. No database/network.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes,createRequire} from 'node:module';
const root=new URL('./overlay/',import.meta.url);
let z,realSchema=false;
if(process.argv.includes('--local-fixtures')) {
  // Host has no node_modules: local runs test behaviour, not Zod validation.
  const schema=new Proxy({parse:value=>value},{get:(target,key)=>key==='parse'?target.parse:()=>schema});z=schema;
} else {
  // Actual image must use its locked validator; no automatic fallback.
  z=createRequire('/app/packages/domain/package.json')('zod').z;realSchema=true;
}
class DomainError extends Error{constructor(code){super(code);this.code=code;}}
async function moduleAt(path,dependencies){
 const context=vm.createContext({console,Date,Promise,URL,FormData,process:{env:{MINIO_PHOTOS_BUCKET:'aia-accreditation-staging-photos'}}});
 const module=new vm.SourceTextModule(stripTypeScriptTypes(await readFile(new URL(path,root),'utf8')),{context});
 await module.link(name=>{assert(Object.hasOwn(dependencies,name),'Unexpected import '+name);const values=dependencies[name];return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});
 await module.evaluate();return module.namespace;
}
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const input={id,expectedVersion:3,confirmed:true};
const domain=await moduleAt('packages/domain/src/events/deletion.ts',{
 zod:{z},'../shared/transaction.ts':{transaction:(db,work)=>db.$transaction(work)},
 '../auth/authorization.ts':{resolveActor:async(_tx,actor)=>actor,requireAdmin:actor=>{if(actor.role!=='ADMIN')throw new DomainError('FORBIDDEN');}},
 '../audit/append.ts':{appendAudit:async(tx,actor,data)=>tx.saveAudit(actor,data)},
 '../notifications/outbox.ts':{enqueueInvalidation:async(tx,key,data)=>tx.saveInvalidation(key,data)},
 '../shared/errors.ts':{DomainError},
});
const guards=['companyEventRegistration','eventParticipant','privacyNotice','privacyAcknowledgement','eventRetentionPolicy','eventPrivacyHold','privacyErasureJob','storageDeletion','notification','outboxMessage'];
function fixture(options={}){
 let state={event:{id,name:'Synthetic accidental draft',status:options.status??'DRAFT',version:3,bannerObjectKey:options.banner??null},links:[id,other],deletions:[],audits:[],invalidations:[]};
 const calls=[];
 const tx={event:{findUnique:async({where})=>{calls.push('read');assert.equal(where.id,id);return options.missing?null:state.event;},deleteMany:async({where})=>{assert.equal(where.id,id);assert.equal(where.version,3);assert.equal(where.status,'DRAFT');calls.push('event.delete');if(options.staleDelete)return {count:0};state.event=null;return {count:1};}},
 operationalHeartbeat:{findUnique:async()=>options.quarantine?{errorCount:1}:null},
 eventZone:{deleteMany:async({where})=>{assert.equal(where.eventId,id);calls.push('eventZone.delete');state.links=state.links.filter(eventId=>eventId!==id);}},
 saveAudit:async(actor,data)=>{assert.equal(actor.role,'ADMIN');assert.equal(data.action,'EVENT_DELETED');assert.equal(data.eventId,id);if(options.auditFailure)throw new Error('AUDIT_FAILURE');state.audits.push(data);},
 saveInvalidation:async(key,data)=>{assert.equal(key,`event:${id}:deleted:4`);assert.equal(data.version,4);if(options.invalidationFailure)throw new Error('OUTBOX_FAILURE');state.invalidations.push(data);},
 };
 for(const name of guards){
  tx[name]={count:async({where})=>{assert.equal(where.eventId,id);if(name==='outboxMessage')assert.equal(where.type.not,'DOMAIN_INVALIDATION');return options.block===name?1:0;}};
 }
 tx.storageDeletion.create=async({data})=>{assert.equal(data.bucket,'aia-accreditation-staging-photos');assert.equal(data.eventId,id);assert(data.objectKey.startsWith(`events/${id}/branding/`));state.deletions.push(data);};
 const db={$transaction:async work=>{const before=structuredClone(state);try{return await work(tx);}catch(error){state=before;throw error;}}};
 return {db,calls,get state(){return state;}};
}
const admin={role:'ADMIN'};let count=0;
let f=fixture();await domain.deleteUnusedEvent(f.db,admin,input);
assert.equal(f.state.event,null);assert.deepEqual(f.state.links,[other]);assert.equal(f.state.audits.length,1);assert.equal(f.state.invalidations.length,1);count++;
f=fixture();await assert.rejects(domain.deleteUnusedEvent(f.db,{role:'COMPANY_LEADER'},input),e=>e.code==='FORBIDDEN');assert.equal(f.calls.length,0);count++;
for(const block of guards){f=fixture({block});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input),e=>e.code==='EVENT_DELETE_BLOCKED');assert(!f.calls.includes('event.delete'));assert.equal(f.state.links.length,2);count++;}
for(const status of ['ONBOARDING_OPEN','ONBOARDING_CLOSED','ACTIVE','COMPLETED','ARCHIVED']){f=fixture({status});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input),e=>e.code==='EVENT_DELETE_BLOCKED');assert(!f.calls.includes('eventZone.delete'));count++;}
f=fixture();await assert.rejects(domain.deleteUnusedEvent(f.db,admin,{...input,expectedVersion:2}),e=>e.code==='STALE_WRITE');assert(!f.calls.includes('event.delete'));count++;
f=fixture({missing:true});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input),e=>e.code==='NOT_FOUND');count++;
f=fixture({quarantine:true});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input),e=>e.code==='EVENT_DELETE_BLOCKED');count++;
f=fixture({banner:`events/${other}/branding/private.jpg`});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input),e=>e.code==='EVENT_DELETE_BLOCKED');assert.equal(f.state.deletions.length,0);count++;
f=fixture({banner:`events/${id}/branding/synthetic.jpg`});await domain.deleteUnusedEvent(f.db,admin,input);assert.equal(f.state.deletions.length,1);count++;
for(const options of [{staleDelete:true},{auditFailure:true},{invalidationFailure:true}]){f=fixture({...options,banner:`events/${id}/branding/synthetic.jpg`});await assert.rejects(domain.deleteUnusedEvent(f.db,admin,input));assert(f.state.event);assert.deepEqual(f.state.links,[id,other]);assert.equal(f.state.deletions.length,0);assert.equal(f.state.audits.length,0);assert.equal(f.state.invalidations.length,0);count++;}
if(realSchema)for(const invalid of [{...input,confirmed:false},{...input,expectedVersion:0},{...input,id:'invalid'},{...input,extra:true}]){f=fixture();await assert.rejects(domain.deleteUnusedEvent(f.db,admin,invalid));assert.equal(f.calls.length,0);count++;}
const actionPath='apps/web/src/app/[locale]/admin/setup/actions.ts';
const actionSource=await readFile(new URL(actionPath,root),'utf8');
const exportNames=actionSource.match(/import\s*\{([^}]+)\}\s*from\s*"@aia\/domain"/s)[1].split(',').map(x=>x.trim()).filter(Boolean);
let actionCalls=[],authorised=true,outcome='ok',revalidated=[];
const fakeDomain=Object.fromEntries(exportNames.map(name=>[name,()=>{throw new Error('Unrelated action called');}]));
fakeDomain.DomainError=DomainError;fakeDomain.deleteUnusedEvent=async(_db,context,data)=>{actionCalls.push(data);assert.equal(context.role,'ADMIN');if(outcome!=='ok')throw new DomainError(outcome);};
const action=await moduleAt(actionPath,{
 'next/cache':{revalidatePath:(...args)=>revalidated.push(args)},'next/navigation':{redirect:url=>{throw Object.assign(new Error(),{digest:'NEXT_REDIRECT',url});}},
 '@aia/config':{parseAuthEnv:()=>({})},'@aia/domain':fakeDomain,
 '../../../../server/session.ts':{requirePortal:async(_locale,role)=>{assert.equal(role,'ADMIN');if(!authorised)throw Object.assign(new Error(),{digest:'NEXT_REDIRECT',url:'/sign-in'});return {context:admin};}},
 '../../../../server/runtime.ts':{database:()=>({})},'../../../../server/event-banner.ts':{storeEventBanner:()=>{}},'../../../../server/storage.ts':{objectStorage:()=>({})},
});
function form(locale='en',confirmed='yes'){const data=new FormData();for(const[k,v]of Object.entries({locale,eventId:id,expectedVersion:'3',confirmed}))data.set(k,v);return data;}
for(const locale of ['en','pt']){await assert.rejects(action.deleteUnusedEventAction(form(locale)),e=>e.url===`/${locale}/admin/setup?result=event_deleted`);assert.equal(actionCalls.at(-1).confirmed,true);assert(revalidated.some(args=>args[0]===`/${locale}/admin`&&args[1]==='layout'));count++;}
for(const [code,result] of [['EVENT_DELETE_BLOCKED','event_blocked'],['STALE_WRITE','event_stale']]){outcome=code;await assert.rejects(action.deleteUnusedEventAction(form()),e=>e.url===`/en/admin/setup?result=${result}&eventId=${id}`);count++;}
outcome='ok';const boundary=actionCalls.length;await assert.rejects(action.deleteUnusedEventAction(form('en','no')),e=>e.url.includes('result=error'));assert.equal(actionCalls.length,boundary);count++;
authorised=false;await assert.rejects(action.deleteUnusedEventAction(form()),e=>e.url==='/sign-in');assert.equal(actionCalls.length,boundary);count++;
console.log(`PASS: ${count} event deletion/action scenarios; ${realSchema?'locked Zod validation':'local behaviour fixtures (Zod validation deferred to image)'}; protected data and shared catalogues preserved; rollback and consent/auth guards checked.`);
