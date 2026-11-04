import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parse} from 'dotenv';
import {parseEnv,parseAuthEnv,parseStorageEnv,deploymentMode} from '../../packages/config/src/index.ts';
try {
 const file=process.env.AIA_RUNTIME_ENV_FILE;
 if(!file || !file.startsWith('/run/secrets/'))throw Error('MOUNTED_RUNTIME_CONFIGURATION_REQUIRED');
 const values=parse(readFileSync(file));
 if(Object.keys(values).some(k=>['AIA_ENTRY_ROLE','AIA_RUNTIME_ENV_FILE'].includes(k)||!/^(DEPLOYMENT_ENV|NODE_ENV|AIA_|APP_|AUTH_|DOCUMENT_|NEXT_PUBLIC_CLERK_|CLERK_|DATABASE_URL|TEST_DATABASE_URL|MIGRATION_|PRIVACY_DATABASE_URL|BACKUP_|RECOVERY_|MONITOR_|CONTAINER_|QUEUE_|REQUEST_|SECRET_|PRIVATE_|MINIO_|REDIS_|SMTP_|EMAIL_|WORKER_|PGSSLROOTCERT|RESEND_WEBHOOK_SECRET$|RESEND_MONITOR_API_KEY$|RESEND_MONITOR_FROM_DOMAINS$)/.test(k)))throw Error('UNEXPECTED_RUNTIME_KEY');
 for(const [k,v]of Object.entries(values))process.env[k]=v;
 if(process.env.NODE_ENV!=='production')throw Error('PRODUCTION_NODE_RUNTIME_REQUIRED');
 const role=process.env.AIA_ENTRY_ROLE;
 if(role==='web'||role==='worker') {
  parseEnv(process.env);parseAuthEnv(process.env);parseStorageEnv(process.env);
  if(role==='web' && ['PRIVACY_DATABASE_URL','MIGRATION_DATABASE_URL','BACKUP_DATABASE_URL','BACKUP_ENCRYPTION_KEY_FILE','RECOVERY_CUSTODY_KEY_FILE'].some(k=>process.env[k]))throw Error('PRIVILEGED_WEB_CONFIGURATION_FORBIDDEN');
  if(role==='web') {const b=JSON.parse(readFileSync('/app/deployment/build.json','utf8'));const hash=createHash('sha256').update(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY??'').digest('hex');if(hash!==b.publicKeyHash && (deploymentMode()==='production'||process.env.CLERK_SECRET_KEY))throw Error('CLERK_PUBLIC_KEY_BUILD_MISMATCH');}
 }
 const [command,...args]=process.argv.slice(2);if(!command)throw Error('COMMAND_REQUIRED');
 const child=spawn(command,args,{stdio:'inherit',env:process.env});
 for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>child.kill(signal));
 child.once('error',()=>{console.error('{"code":"CONTAINER_STARTUP_FAILED"}');process.exitCode=1;});
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}catch(error){const message=error instanceof Error?error.message:'';console.error(JSON.stringify({code:/^[A-Z_]{5,80}$/.test(message)?message:'INVALID_CONTAINER_CONFIGURATION'}));process.exitCode=1;}
