// Offline contract check: no alias, endpoint call, root credentials or IAM mutation.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {MC_SHA,validateClient} from './storage-admin.mjs';
try{
  const path='/usr/local/bin/mc',hash=createHash('sha256').update(readFileSync(path)).digest('hex');
  if(hash!==MC_SHA)throw Error('PINNED_MC_CHECKSUM_MISMATCH');
  const run=args=>{const r=spawnSync(path,args,{env:{PATH:process.env.PATH,HOME:'/tmp'},stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:10000,maxBuffer:256*1024});if(r.status!==0||r.error)throw Error('MC_OFFLINE_CONTRACT_FAILED');return r.stdout;};
  validateClient({hash,version:run(['--version']),importHelp:run(['admin','cluster','iam','import','--help']),exportHelp:run(['admin','cluster','iam','export','--help'])});
  console.log('PINNED_MC_OFFLINE_CONTRACT_PASSED');
}catch(e){console.error(e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'MC_OFFLINE_CONTRACT_FAILED');process.exitCode=1;}
