import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const file=process.argv[2];if(!file)throw Error('EXPLICIT_RELEASE_MANIFEST_REQUIRED');const m=JSON.parse(await readFile(file,'utf8'));
if(!/^aia-accreditation-[a-z0-9-]+$/.test(m.project))throw Error('ACCREDITATION_PROJECT_REQUIRED');
const cli=(args:string[])=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});if(r.status!==0)throw Error('CONTAINER_MONITOR_UNAVAILABLE');return r.stdout.trim();};
const context=JSON.parse(cli(['context','inspect']))[0];if(!/^(unix:|npipe:)/.test(context.Endpoints.docker.Host))throw Error('REMOTE_DOCKER_CONTEXT_FORBIDDEN');
const ids=cli(['ps','-aq','--filter','label=com.docker.compose.project='+m.project]).split(/\r?\n/).filter(Boolean),containers=ids.length?JSON.parse(cli(['inspect',...ids])):[];
const alerts:string[]=[],services=[];for(const c of containers){if(c.Config.Labels?.['com.docker.compose.project']!==m.project)throw Error('CONTAINER_SCOPE_MISMATCH');const service=c.Config.Labels['com.docker.compose.service'];if(['tools','storage-volume-init'].includes(service))continue;const state={service,running:c.State.Running,health:c.State.Health?.Status??'not-configured',restarts:c.RestartCount,oom:c.State.OOMKilled};services.push(state);if(!state.running||state.health==='unhealthy')alerts.push(service.toUpperCase()+'_UNAVAILABLE');if(state.restarts>Number(process.env.CONTAINER_RESTART_ALERT_THRESHOLD??2))alerts.push(service.toUpperCase()+'_RESTARTS_REPEATED');if(state.oom)alerts.push(service.toUpperCase()+'_OOM');}
for(const service of ['web','worker','postgres','redis','minio','ingress'])if(!services.some((s:{service:string})=>s.service===service))alerts.push(service.toUpperCase()+'_MISSING');
console.log(JSON.stringify({project:m.project,services,alerts}));process.exitCode=alerts.length?1:0;
