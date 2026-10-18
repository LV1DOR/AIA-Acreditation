// Actual reviewed source, evaluated offline with mocked React/Next/database boundaries.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=new URL('./overlay/',import.meta.url);
const web='apps/web/src/app/[locale]/admin/operations/';
async function moduleAt(relative,dependencies,globals={}){
 const context=vm.createContext({URL,Date,JSON,FormData,console,process:{env:{}},...globals});
 const code=stripTypeScriptTypes(await readFile(new URL(relative,root),'utf8'));
 const module=new vm.SourceTextModule(code,{context});
 await module.link(name=>{
  assert(Object.hasOwn(dependencies,name),'Unexpected dependency '+name);
  const value=dependencies[name];return new vm.SyntheticModule(Object.keys(value),function(){for(const[k,v]of Object.entries(value))this.setExport(k,v);},{context});
 });await module.evaluate();return module.namespace;
}
const h=(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}});
const icons=Object.fromEntries(['Activity','ArrowLeft','Check','ChevronDown','Clock3','Mail','ShieldCheck'].map(n=>[n,props=>h('svg',{...props,viewBox:'0 0 24 24',width:20,height:20,fill:'none',stroke:'currentColor','stroke-width':1.7},h('path',{d:n==='Check'?'M5 12l4 4L19 6':n==='ChevronDown'?'M6 9l6 6 6-6':n==='ArrowLeft'?'M19 12H5m6-6-6 6 6 6':n==='Mail'?'M3 5h18v14H3z M3 5l9 7 9-7':'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z'}))]));
const view=await moduleAt(web+'privacy-view.ts',{
 react:{createElement:h},'next/link':{default:props=>h('a',props,...props.children)},'lucide-react':icons,
 './privacy-operations.module.css':{default:new Proxy({},{get:(_o,k)=>String(k)})},
});
function resolve(node){
 if(node===null||node===undefined||typeof node==='boolean')return null;
 if(Array.isArray(node))return node.flatMap(n=>{const r=resolve(n);return Array.isArray(r)?r:[r];}).filter(n=>n!==null);
 if(typeof node!=='object')return node;
 if(typeof node.type==='function')return resolve(node.type(node.props));
 return {type:node.type,props:{...node.props,children:resolve(node.props.children)}};
}
function nodes(node,predicate){
 if(!node||typeof node!=='object')return [];
 if(Array.isArray(node))return node.flatMap(n=>nodes(n,predicate));
 return [...(predicate(node)?[node]:[]),...nodes(node.props.children,predicate)];
}
function text(node){if(node===null||node===undefined)return '';if(Array.isArray(node))return node.map(text).join(' ');if(typeof node==='object')return text(node.props.children);return String(node);}
const props={locale:'en',synthetic:true,event:{id:'event-synthetic',name:'Moto GP 2026'},events:[{id:'event-synthetic',name:'Moto GP 2026'}],signals:{workerAvailable:true,failed:0,expiredLeases:0,cleanupFailed:0,backupAgeHours:null},cleanupConfigured:false,notices:[{kind:'WORKER'},{kind:'LEADER'}],jobs:[],deliveries:[],action:async()=>{}};
let count=0;
for(const locale of ['en','pt']){
 const tree=resolve(view.PrivacyOperationsView({...props,locale}));
 assert.equal(nodes(tree,n=>n.type==='h1').length,1);
 assert.equal(nodes(tree,n=>n.type==='input'&&n.props.type==='date').length,0);
 assert.equal(nodes(tree,n=>n.type==='input'&&n.props.name==='intent'&&['policy','hold','erase','communications','authmetadata'].includes(n.props.value)).length,0);
 assert.equal(nodes(tree,n=>n.type==='input'&&n.props.name==='approved'&&n.props.required).length,1);
 assert.equal(nodes(tree,n=>n.type==='textarea'&&n.props.required).length,2);
 assert(!text(tree).includes('00:00'));assert(!text(tree).includes('COPIES_PENDING'));
 assert(text(tree).includes(locale==='en'?'Awaiting AIA policy':'Aguarda política AIA'));
 count++;
}
const activity=resolve(view.PrivacyOperationsView({...props,cleanupConfigured:true,jobs:[{id:'job-private-id',status:'COPIES_PENDING',company:'Synthetic Company',date:'18 Oct 2026',dateTime:'2026-10-18T12:00:00Z'}],deliveries:[{id:'message-private-id',kind:'auth',uncertain:true,recoverable:false,date:'18 Oct',dateTime:'2026-10-18T11:00:00Z'},{id:'message-2',kind:'update',uncertain:true,recoverable:true,date:'18 Oct',dateTime:'2026-10-18T11:00:00Z'}]}));
assert(text(activity).includes('Verification needed'));assert(!text(activity).includes('job-private-id'));
assert.equal(nodes(activity,n=>n.type==='input'&&n.props.name==='intent'&&n.props.value==='recover').length,1);count++;
const domainCalls=[];
class DomainError extends Error{constructor(code){super();this.code=code;}}
const action=await moduleAt(web+'actions.ts',{
 'next/navigation':{redirect:url=>{throw Object.assign(new Error(),{digest:'NEXT_REDIRECT',url});}},'next/cache':{revalidatePath:()=>{}},
 '@aia/domain':{publishPrivacyNotice:async(...args)=>domainCalls.push(['notice',...args]),recoverDelivery:async(...args)=>domainCalls.push(['recover',...args]),DomainError},
 '@/server/session.ts':{requirePortal:async(_locale,role)=>{assert.equal(role,'ADMIN');return {context:{actor:'synthetic-admin'}};}},'@/server/runtime.ts':{database:()=>({})},
});
for(const intent of ['policy','hold','communications','authmetadata','erase','copies','evidence','reauthorise']){
 const data=new FormData();data.set('intent',intent);data.set('eventId','event-synthetic');data.set('locale','en');
 await assert.rejects(action.operationalAction(data),e=>e.url.includes('result=invalid_input'));
}assert.equal(domainCalls.length,0);count++;
const notice=new FormData();for(const[k,v]of Object.entries({intent:'notice',locale:'en',eventId:'event-synthetic',kind:'WORKER',noticeVersion:'test-only',textPt:'Synthetic Portuguese notice for tests',textEn:'Synthetic English notice for tests',reference:'SYNTHETIC-APPROVAL',approved:'on'}))notice.set(k,v);
await assert.rejects(action.operationalAction(notice),e=>e.url.includes('result=saved'));
assert.equal(domainCalls[0][0],'notice');assert.equal(domainCalls[0][3].approved,true);count++;
const retry=new FormData();retry.set('locale','en');retry.set('intent','recover');retry.set('messageId','message-synthetic');
await assert.rejects(action.operationalAction(retry),e=>e.url.includes('result=reissued'));assert.equal(domainCalls[1][0],'recover');count++;
const unhealthy=resolve(view.PrivacyOperationsView({...props,cleanupConfigured:true,signals:{...props.signals,communicationCleanupFailed:true}}));
assert(nodes(unhealthy,n=>n.type==='div'&&n.props.className==='fact').some(n=>text(n).includes('Routine cleanup')&&text(n).includes('Needs attention')));count++;
let adminChecked=false,dbReads=0;
const controllerDependencies={
 react:{createElement:h},'@aia/config':{syntheticMode:()=>true},'next-intl/server':{getLocale:async()=> 'en'},
 '@aia/domain':{
  adminEventOptions:async()=>[{id:'event-one',name:'First'},{id:'event-two',name:'Selected event'}],
  adminOperationalSignals:async()=>props.signals,deliveryRecoveryOverview:async()=>[],
  privacyOperationsOverview:async(_db,_context,eventId)=>{assert.equal(eventId,'event-two');return {policy:{synthetic:true,approvalReference:'PRIVATE_POLICY_REFERENCE'},notices:[],jobs:[],registrations:[]};},
 },
 '@/server/session.ts':{requirePortal:async(_locale,role)=>{assert.equal(role,'ADMIN');adminChecked=true;return {context:{}};}},
 '@/server/runtime.ts':{database:()=>{assert(adminChecked);dbReads++;return {};}},
 './actions.ts':{operationalAction:async()=>{}},'./privacy-view.ts':{PrivacyOperationsView:view.PrivacyOperationsView},
};
const controller=await moduleAt(web+'page.tsx',controllerDependencies);
const loaded=await controller.default({searchParams:Promise.resolve({eventId:'event-two',registrationId:'legacy-url',stage:'ALL_EVIDENCE'})});
assert.equal(loaded.props.event.id,'event-two');assert.equal(loaded.props.cleanupConfigured,true);assert(!JSON.stringify(loaded.props).includes('PRIVATE_POLICY'));assert.equal(dbReads,1);count++;
const denied=await moduleAt(web+'page.tsx',{...controllerDependencies,'@/server/session.ts':{requirePortal:async()=>{throw Object.assign(new Error(),{digest:'NEXT_REDIRECT'});}}});
await assert.rejects(denied.default({searchParams:Promise.resolve({})}));assert.equal(dbReads,1);count++;

// Render the actual reviewed component and stylesheet for desktop/mobile review.
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function html(node){
 if(node===null||node===undefined)return '';if(Array.isArray(node))return node.map(html).join('');if(typeof node!=='object')return escape(node);
 const attrs=Object.entries(node.props).filter(([k,v])=>!['children','key','action','defaultValue'].includes(k)&&typeof v!=='function'&&v!==undefined&&v!==false).map(([k,v])=>`${k==='className'?'class':k==='htmlFor'?'for':k==='dateTime'?'datetime':k}="${escape(v===true?'':v)}"`).join(' ');
 if(['input','br','hr'].includes(node.type))return `<${node.type} ${attrs}>`;
 return `<${node.type} ${attrs}>${html(node.props.children)}</${node.type}>`;
}
if(process.argv.includes('--preview')){
 const css=await readFile(new URL(web+'privacy-operations.module.css',root),'utf8');
 const out=new URL('./preview.html',import.meta.url);
 const base=`*{box-sizing:border-box}body{margin:0;background:#f5f5f2;font-family:Arial,sans-serif;padding:34px}button,select,input,textarea{font:inherit}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;border:1px solid #d4d8de;border-radius:6px;background:#fff;color:#303740;font-size:12px;font-weight:650;text-decoration:none}.button.primary{background:#cd1b30;border-color:#cd1b30;color:#fff}@media(max-width:620px){body{padding:20px 14px}}`;
 await writeFile(out,`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic privacy UI preview</title><style>${base}${css}</style><body>${html(resolve(view.PrivacyOperationsView(props)))}</body></html>`);
 console.log('PREVIEW '+fileURLToPath(out));
}
console.log(`PASS: ${count} privacy UI/action scenarios; both locales; destructive intents removed; notice approval and admin checks preserved.`);
