import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {localStage} from './lib/phase4a-stage.ts';
const s=await localStage(),worker=s.project+'-worker-1',web=s.project+'-web-1';
const probe=(name:string,path='ready')=>spawnSync('docker',['exec',name,'node','-e',`fetch('http://127.0.0.1:${name===worker?3102:3100}/api/health/${path}',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`],{stdio:'ignore',windowsHide:true}).status===0;
const wait=async(name:string,path='ready')=>{for(let n=0;n<45;n++){if(probe(name,path))return;await new Promise(r=>setTimeout(r,1000));}throw Error('STAGING_RECOVERY_TIMEOUT');};
const evidence:Record<string,unknown>={synthetic:true};
await wait(worker);await wait(web,'live');
for(const role of ['redis','minio','postgres']){s.command(['stop',role]);try{if(probe(worker))throw Error('UNAVAILABLE_DEPENDENCY_NOT_DETECTED');if(!probe(worker,'live'))throw Error('LIVENESS_LOST_DURING_DEPENDENCY_OUTAGE');}finally{s.command(['start',role]);}await wait(worker);evidence[role+'InterruptionRecovered']=true;}
for(const name of ['worker','web']){const started=Date.now();s.command(['stop',name]);const details=JSON.parse(spawnSync('docker',['inspect',s.project+'-'+name+'-1'],{encoding:'utf8'}).stdout)[0],elapsed=Date.now()-started;try{if(details.State.OOMKilled||!(name==='web'?[0,143]:[0]).includes(details.State.ExitCode)||elapsed>50000)throw Error('UNCLEAN_CONTAINER_SHUTDOWN');}finally{s.command(['start',name]);}await wait(s.project+'-'+name+'-1',name==='web'?'live':'ready');evidence[name+'ShutdownRestart']={exitCode:details.State.ExitCode,elapsedMs:elapsed,oom:false};}
const file=s.run+'/bad-activation.yaml';await writeFile(file,'services:\n  worker:\n    restart: "no"\n    command: [node, -e, "process.exit(1)"]\n');
try{s.command(['-f',file,'up','-d','--no-deps','worker']);await new Promise(r=>setTimeout(r,1500));if(probe(worker))throw Error('FAILED_ACTIVATION_NOT_DETECTED');evidence.failedActivationDetected=true;}finally{s.command(['up','-d','--no-deps','worker']);await wait(worker);}
evidence.knownGoodWorkerRestored=true;evidence.webLiveness=true;evidence.webReadiness=probe(web);await writeFile(s.run+'/backups/interruption-rehearsal.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,...evidence}));
