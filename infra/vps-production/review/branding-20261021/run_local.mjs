import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=path.resolve(process.argv[2]??new URL('../source',import.meta.url).pathname);
const require=createRequire(import.meta.url);
const ts=require(process.env.AIA_TYPESCRIPT_PATH??'./node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js');
let passed=0;
function check(name,work){return Promise.resolve().then(work).then(()=>{passed++;console.log('PASS '+name);});}
function load(rel,mocks={}){
 const file=path.join(root,rel),source=fs.readFileSync(file,'utf8');
 const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(parsed.parseDiagnostics.length,0,rel+' syntax');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const m={exports:{}};
 const isolatedRequire=name=>{assert.ok(Object.hasOwn(mocks,name),'Unexpected dependency '+name+' in '+rel);return mocks[name];};
 vm.runInNewContext('(function(require,module,exports){'+js+'\n})',{Date,URL,FormData,console,process:{env:{}}}, {filename:rel})(isolatedRequire,m,m.exports);
 return m.exports;
}
const settings=load('packages/domain/src/privacy/settings.ts');
await check('single worker notice kind shared by roles',()=>assert.equal(settings.sharedPrivacyNoticeKind,'WORKER'));
await check('new policy derives communications/evidence from worker date',()=>{
 const records=new Date('2030-01-01'),backups=new Date('2031-01-01');
 const p=settings.privacyRetentionDates(records,backups);
 assert.equal(p.evidenceEraseAfter,records);assert.equal(p.communicationsEraseAfter,records);assert.equal(p.backupsEraseAfter,backups);
 assert.equal(records.toISOString(),'2030-01-01T00:00:00.000Z');
});
await check('audit reference is an internal action ID',()=>assert.equal(settings.privacyActionReference('fixture-correlation'),'admin-action:fixture-correlation'));
const h=(type,props,...children)=>({type,props:props??{},children});
const icon=()=>null;
const view=load('apps/web/src/app/[locale]/admin/operations/privacy-view.ts',{
 react:{createElement:h},'next/link':{__esModule:true,default:icon},'lucide-react':{Activity:icon,ArrowLeft:icon,Check:icon,ChevronDown:icon,Clock3:icon,Mail:icon,ShieldCheck:icon},
 './privacy-operations.module.css':{__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})},
});
function nodes(tree,result=[]){if(Array.isArray(tree))for(const n of tree)nodes(n,result);else if(tree&&typeof tree==='object'){result.push(tree);nodes(tree.children,result);}return result;}
for(const locale of ['pt','en'])await check(locale+' screen has one shared notice and only two retention date inputs',()=>{
 const tree=view.PrivacyOperationsView({locale,synthetic:false,event:{id:'fixture',name:'Fixture event'},events:[],signals:{workerAvailable:true,failed:0,expiredLeases:0,cleanupFailed:0,backupAgeHours:1},cleanupConfigured:false,notices:[{kind:'WORKER',label:'v1'}],jobs:[],deliveries:[],action:async()=>{}});
 const rendered=nodes(tree),inputs=rendered.filter(n=>n.type==='input');
 assert.deepEqual(inputs.filter(n=>n.props.type==='date').map(n=>n.props.name),['recordsEraseAfter','backupsEraseAfter']);
 assert.ok(!inputs.some(n=>['reference','approvalReference','evidenceEraseAfter','communicationsEraseAfter'].includes(n.props.name)));
 assert.equal(inputs.filter(n=>n.props.name==='kind').length,1);
 assert.equal(inputs.find(n=>n.props.name==='kind').props.value,'WORKER');
 assert.ok(!rendered.some(n=>n.type==='option'&&n.props.value==='LEADER'));
 const text=JSON.stringify(tree);assert.ok(!text.includes('Company leader declaration'));assert.ok(!text.includes('Declaração do responsável'));
});
const messages=load('apps/web/src/app/[locale]/admin/companies/invitation-errors.ts');
await check('privacy errors explain the required screen',()=>{
 assert.match(messages.invitationMessage('privacy_configuration_required','en'),/shared privacy notice/);
 assert.match(messages.invitationMessage('retention_policy_required','pt'),/datas de conservação/);
});
const actionPath='apps/web/src/app/[locale]/admin/companies/actions.ts';
class DomainError extends Error{constructor(code){super(code);this.code=code;}}
function redirected(destination){const e=new Error('redirect');e.digest='NEXT_REDIRECT';e.destination=destination;throw e;}
function actions({blocked=false,pending=0}={}){
 const calls=[];
 const domain={DomainError,assertCollectionAllowed:async()=>{calls.push('privacy');if(blocked)throw new DomainError('PRIVACY_CONFIGURATION_REQUIRED');},createCompany:async()=>{calls.push('createCompany');return{id:'company'};},createRegistration:async()=>{calls.push('createRegistration');return{id:'registration'};},issueLeaderInvitation:async()=>{calls.push('invite');}};
 const db={leaderInvitation:{count:async()=>pending},companyEventRegistration:{findUniqueOrThrow:async()=>({eventId:'fixture-event'})}};
 const schema={parse:v=>v,safeParse:v=>({success:true,data:v})};
 const z={object:()=>schema,uuid:()=>schema,string:()=>schema,email:()=>schema};Object.assign(schema,{trim:()=>schema,min:()=>schema,max:()=>schema});
 const module=load(actionPath,{'zod':{z},'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:redirected},'@aia/config':{parseAuthEnv:()=>({APP_ORIGIN:'https://fixture.invalid',AUTH_EMAIL_ENCRYPTION_KEY:'fixture'})},'@aia/domain':domain,'../../../../server/session.ts':{requirePortal:async(_,role)=>{assert.equal(role,'ADMIN');return{context:{}};}},'../../../../server/runtime.ts':{database:()=>db}});
 return{module,calls};
}
function form(values){const f=new FormData();for(const [k,v]of Object.entries(values))f.set(k,v);return f;}
await check('missing policy/notice blocks before creating company or registration',async()=>{
 const {module,calls}=actions({blocked:true});
 await assert.rejects(()=>module.createInvitedCompanyAction(form({locale:'en',eventId:'fixture',name:'Fixture',email:'fixture@example.invalid'})),e=>e.destination.includes('privacy_configuration_required'));
 assert.deepEqual(calls,['privacy']);
});
await check('existing registration invitation does not recreate company',async()=>{
 const {module,calls}=actions();
 await assert.rejects(()=>module.inviteExistingCompanyAction(form({locale:'en',registrationId:'fixture-registration',email:'fixture@example.invalid'})),e=>e.destination.includes('eventId=fixture-event&result=invitation_queued'));
 assert.deepEqual(calls,['invite']);
});
await check('existing valid invitation blocks another send',async()=>{
 const {module,calls}=actions({pending:1});
 await assert.rejects(()=>module.inviteExistingCompanyAction(form({locale:'en',registrationId:'fixture-registration',email:'fixture@example.invalid'})),e=>e.destination.includes('invitation_pending'));
 assert.deepEqual(calls,[]);
});
console.log('LOCAL_BEHAVIOUR_CHECKS_PASSED='+passed+'; real Zod/Prisma/Vitest checks still required in pinned tools image.');
