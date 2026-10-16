import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse} from 'dotenv';
import {parseEnv,parseAuthEnv,parseStorageEnv} from '../packages/config/src/index.ts';
import {validateDatabaseTarget,type Target} from './lib/targets.ts';
type Manifest={environment:'staging'|'production';project:string;composeEnv:string;sourceSha:string;target:Target;storageSupportReference?:string;synthetic?:boolean};
const file=process.argv[2];if(!file)throw Error('EXPLICIT_RELEASE_MANIFEST_REQUIRED');const m=JSON.parse(await readFile(file,'utf8')) as Manifest;
const require=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
require(['staging','production'].includes(m.environment)&&/^aia-accreditation-[a-z0-9-]+$/.test(m.project)&&/^[a-f0-9]{64}$/.test(m.sourceSha),'INVALID_RELEASE_MANIFEST');
const cli=(args:string[])=>{const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});if(r.status!==0)throw Error('LOCAL_DOCKER_PREFLIGHT_FAILED');return r.stdout.trim();};
const context=JSON.parse(cli(['context','inspect']))[0];require(/^(unix:|npipe:)/.test(context.Endpoints.docker.Host),'REMOTE_DOCKER_CONTEXT_FORBIDDEN');
const env=parse(await readFile(m.composeEnv)),secrets=env.AIA_SECRETS_DIRECTORY!;
require(env.AIA_PROJECT_NAME===m.project,'COMPOSE_PROJECT_MISMATCH');
const extra=m.synthetic?['-f','infra/production/compose.staging.yaml']:[];
require(m.environment!=='production'||m.synthetic!==true,'SYNTHETIC_PRODUCTION_FORBIDDEN');
const config=JSON.parse(cli(['compose','--env-file',resolve(m.composeEnv),'-f','infra/production/compose.yaml',...extra,'config','--format','json']));
const fingerprints:Record<string,string>={};
for(const role of ['web','worker']) {
 const contents=await readFile(resolve(secrets,role+'.env'),'utf8'),values=parse(contents);fingerprints[role]=createHash('sha256').update(contents).digest('hex');
 require(values.DEPLOYMENT_ENV===m.environment&&values.NODE_ENV==='production','DEPLOYMENT_ENVIRONMENT_MISMATCH');parseEnv(values);parseAuthEnv(values);parseStorageEnv(values);validateDatabaseTarget(values.DATABASE_URL!,m.target);
 if(role==='web')require(!values.PRIVACY_DATABASE_URL&&!values.MIGRATION_DATABASE_URL&&!values.BACKUP_DATABASE_URL,'PRIVILEGED_WEB_CONFIGURATION_FORBIDDEN');
 const service=config.services[role];require(service.read_only===true&&service.mem_limit>0&&service.cpus>0&&!service.privileged&&!service.ports,'APP_ISOLATION_REQUIRED');
 require(service.cap_drop.includes('ALL')&&service.security_opt.includes('no-new-privileges:true'),'APP_PRIVILEGE_REDUCTION_REQUIRED');
 const image=JSON.parse(cli(['image','inspect',service.image]))[0];require(['node','1000','1000:1000'].includes(image.Config.User),'NONROOT_APP_IMAGE_REQUIRED');require(image.Config.Labels?.['org.opencontainers.image.revision']===m.sourceSha,'IMAGE_SOURCE_MISMATCH');
 if(m.environment==='production')require(/@sha256:[a-f0-9]{64}$/.test(service.image),'REGISTRY_DIGEST_PIN_REQUIRED');fingerprints[role+'Image']=image.Id;
}
require(config.networks.backend.internal===true,'PRIVATE_BACKEND_NETWORK_REQUIRED');
for(const role of ['postgres','redis','minio'])require(!config.services[role].ports,'PUBLIC_BACKEND_PORT_FORBIDDEN');
for(const port of config.services.ingress.ports)require(port.host_ip==='127.0.0.1','INGRESS_COEXISTENCE_BIND_REQUIRED');
if(m.environment==='production'){require(m.storageSupportReference&&m.storageSupportReference.length>=5,'SUPPORTED_STORAGE_REVIEW_REQUIRED');require(!env.AIA_MINIO_IMAGE!.includes('14cea493d9a34af32'),'LEGACY_UNMAINTAINED_MINIO_FORBIDDEN');require(/@sha256:[a-f0-9]{64}$/.test(env.AIA_MINIO_IMAGE!),'STORAGE_DIGEST_PIN_REQUIRED');}
console.log(JSON.stringify({status:'PREFLIGHT_PASSED',environment:m.environment,project:m.project,sourceSha:m.sourceSha,fingerprints,productionAuthorised:false}));
