import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'dotenv';
export async function localStage() {
 const root=resolve('.impeccable/review/phase4a/staging'),s=JSON.parse(await readFile('.impeccable/review/phase4a/active-stage.json','utf8'));
 if(s.synthetic!==true||!/^aia-accreditation-phase4a-[a-f0-9]{8}$/.test(s.project)||!resolve(s.run).startsWith(root+sep)||resolve(s.composeEnv)!==resolve(s.run,'compose.env'))throw Error('INVALID_SYNTHETIC_STAGE');
 const v=parse(await readFile(s.composeEnv));if(v.AIA_PROJECT_NAME!==s.project||v.AIA_HTTPS_BIND_PORT!=='18443'||v.AIA_HTTP_BIND_PORT!=='18880')throw Error('STAGING_TARGET_CHANGED');
 const args=['compose','--env-file',s.composeEnv,'-f','infra/production/compose.yaml','-f','infra/production/compose.staging.yaml'];
 const command=(more:string[],capture=false)=>{const r=spawnSync('docker',[...args,...more],{windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024,stdio:capture?'pipe':'inherit'});if(r.status!==0)throw Error('ISOLATED_COMPOSE_OPERATION_FAILED');return r.stdout??'';};
 return {...s,vars:v,args,command};
}
