import {config} from "dotenv";
import {readFile,realpath,readlink,symlink,rename,stat,unlink} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {validateDatabaseTarget,releaseSequence,type Target} from "./lib/targets.ts";
import {verifyBackupReceipt} from "./lib/backup.ts";
config({quiet:true});
const command=process.argv[2];if(!['prepare','promote'].includes(command??''))throw Error('EXPLICIT_RELEASE_COMMAND_REQUIRED');
const required=(k:string)=>{const v=process.env[k];if(!v)throw Error('RELEASE_CONFIGURATION_REQUIRED');return v;};
const target=JSON.parse(await readFile(required('MIGRATION_TARGET_FILE'),'utf8')) as Target;validateDatabaseTarget(required('MIGRATION_DATABASE_URL'),target);
const root=resolve(required('RELEASE_ARTIFACT_ROOT')),candidate=await realpath(required('RELEASE_CANDIDATE_PATH'));if(!candidate.startsWith(root+sep))throw Error('RELEASE_CANDIDATE_SCOPE_MISMATCH');
const verifyCandidate=async()=>{await stat(join(candidate,'apps/web/.next/BUILD_ID'));await stat(join(candidate,'apps/worker/dist/main.js'));await stat(join(candidate,'pnpm-lock.yaml'));const checks=JSON.parse(await readFile(join(candidate,'release-validation.json'),'utf8'));if(checks.status!=='PASSED'||!checks.migrationCompatibilityReviewed)throw Error('VALIDATED_IMMUTABLE_CANDIDATE_REQUIRED');return candidate;};
const migrate=(preflight:boolean)=>{const result=spawnSync('corepack pnpm exec tsx scripts/migrate.ts'+(preflight?' --preflight':''),{cwd:candidate,shell:true,stdio:'inherit',windowsHide:true});if(result.status!==0)throw Error('RELEASE_MIGRATION_FAILED');};
if(command==='prepare'){await verifyCandidate();await verifyBackupReceipt(required('BACKUP_RECEIPT_FILE'),target);migrate(true);console.log('PASS: release candidate, target, backup and migration preflight; running services untouched');}
else {
 if(process.platform==='win32')throw Error('LINUX_PROMOTION_ONLY_USE_LOCAL_SERVICE_COMMAND_ON_WINDOWS');required('RELEASE_OPERATOR_APPROVAL_REFERENCE');
 const current=join(resolve(required('RELEASE_CURRENT_PARENT')),'current');const previous=await readlink(current);const previousReal=await realpath(current);if(!previousReal.startsWith(root+sep))throw Error('KNOWN_GOOD_RELEASE_SCOPE_MISMATCH');
 const switchTo=async(path:string)=>{const next=current+'.candidate';await unlink(next).catch(e=>{if(e.code!=='ENOENT')throw e;});await symlink(path,next);await rename(next,current);execFileSync('systemctl',['restart','aia-accreditation-web','aia-accreditation-worker'],{stdio:'inherit'});};
 await releaseSequence({validate:async()=>{validateDatabaseTarget(required('MIGRATION_DATABASE_URL'),target);},build:verifyCandidate,backup:async()=>{await verifyBackupReceipt(required('BACKUP_RECEIPT_FILE'),target);},migrationPreflight:async()=>migrate(true),migrate:async()=>migrate(false),activate:switchTo,health:async()=>{for(const port of [3100,3102]){const r=await fetch(`http://127.0.0.1:${port}/api/health/ready`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('CANDIDATE_NOT_READY');}},rollback:async()=>{await switchTo(previous);}});
 console.log('PASS: release promoted; previous artifact retained; database was not rolled back');
}
