import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require=createRequire(import.meta.url);
const ts=require(process.env.AIA_TYPESCRIPT_PATH);
const root=path.resolve(process.argv[2]);
let schema;schema=new Proxy({}, {get:(_,name)=>name==='parse'?v=>v:()=>schema});
const z=new Proxy({}, {get:()=>()=>schema});
class DomainError extends Error{constructor(code){super(code);this.code=code;}}
class EvidenceValidated extends Error{}
function load(base,rel,mocks){const js=ts.transpileModule(fs.readFileSync(path.join(base,rel),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const m={exports:{}};vm.runInNewContext('(function(require,module,exports){'+js+'\n})',{Date,URL,Buffer,console})(name=>{assert.ok(name in mocks,'Unspecified dependency '+name);return mocks[name]},m,m.exports);return m.exports;}
const settings=load(root,'packages/domain/src/privacy/settings.ts',{});
const notices=load(root,'packages/domain/src/privacy/notices.ts',{'node:crypto':require('node:crypto'),zod:{z},'@aia/config':{syntheticMode:()=>false,deploymentMode:()=> 'production'},'../operations/database-role.ts':{assertRestrictedDatabaseRuntime:async()=>{}},'../shared/transaction.ts':{},'../auth/authorization.ts':{},'../shared/errors.ts':{DomainError},'./settings.ts':settings});
const caps={editable:true,canSaveDraft:true,fields:['IDENTITY','CONTACT','ROLE','WORK_DAYS','PHOTO','PRIVACY']};
function service(base){return load(base,'packages/domain/src/participants/service.ts',{'../privacy/notices.ts':notices,'node:crypto':require('node:crypto'),zod:{z},'../audit/append.ts':{},'../auth/authorization.ts':{resolveActor:async()=>({userId:'synthetic-user',role:'COMPANY_LEADER'}),requireCompany:async()=>{}},'./photo-lifecycle.ts':{},'../submissions/eligibility.ts':{},'../events/lifecycle.ts':{},'../shared/calendar-date.ts':{calendarDate:schema},'../shared/errors.ts':{DomainError},'../shared/transaction.ts':{transaction:async(db,work)=>work(db)},'../submissions/capabilities.ts':{participantCapabilities:async()=>caps},'./identity.ts':{},'./phone.ts':{}});}
function db(){const r={id:'synthetic-registration',eventId:'synthetic-event',companyId:'synthetic-company',erasedAt:null};return{eventParticipant:{findUnique:async()=>({id:'synthetic-person',registrationId:r.id,eventId:r.eventId,registration:r,version:1}),findUniqueOrThrow:async()=>({registrationId:r.id})},companyEventRegistration:{findUniqueOrThrow:async()=>r},privacyErasureJob:{count:async()=>0},event:{findUniqueOrThrow:async()=>({name:'Synthetic event'})},privacyNotice:{findFirst:async()=>({id:'synthetic-notice',version:'v1',textPt:'Notice for {event}',textEn:'Notice for {event}',synthetic:false})},eventRetentionPolicy:{findFirst:async()=>({})},privacyAcknowledgement:{create:async()=>{throw new EvidenceValidated()}},participantWorkDay:{findMany:async()=>[]}};}
const hash=createHash('sha256').update('Notice for Synthetic event').digest('hex');
const input={privacyAcknowledged:true,privacyNoticeVersion:'v1',privacyNoticeHash:hash,noticeLocale:'en'};
if(process.argv[3]) {const baseline=service(path.resolve(process.argv[3]));for(const method of ['updateParticipantByLeader','saveParticipantDraft'])await assert.rejects(()=>baseline[method](db(),{},'synthetic-person',input,{}),e=>e instanceof DomainError&&e.code==='PRIVACY_NOTICE_CHANGED');console.log('BASELINE_SAVE_AND_DRAFT_NOTICE_HASH_OMISSION_REPRODUCED');}
const patched=service(root);
for(const method of ['updateParticipantByLeader','saveParticipantDraft']){
 await assert.rejects(()=>patched[method](db(),{},'synthetic-person',input,{}),e=>e instanceof EvidenceValidated);
 for(const privacyNoticeHash of [undefined,'0'.repeat(64)])await assert.rejects(()=>patched[method](db(),{},'synthetic-person',{...input,privacyNoticeHash},{}),e=>e instanceof DomainError&&e.code==='PRIVACY_NOTICE_CHANGED');
}
console.log('ACTUAL_PRODUCTION_NOTICE_GUARD_ACCEPTS_FORWARDED_HASH_AND_REJECTS_MISSING_OR_FORGED_EVIDENCE');
