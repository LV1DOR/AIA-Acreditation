import {config} from "dotenv";
import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createDatabase} from "../packages/database/src/index.ts";
import {deploymentMode} from "../packages/config/src/deployment-env.ts";
import {validateDatabaseTarget,type Target} from "./lib/targets.ts";
import {verifyBackupReceipt} from "./lib/backup.ts";
const root=fileURLToPath(new URL('../',import.meta.url));config({path:new URL('../.env',import.meta.url),quiet:true});
const mode=deploymentMode(),file=process.env.MIGRATION_TARGET_FILE;
const target:Target=file?JSON.parse(await readFile(file,'utf8')):mode==='local'?{environment:'local',host:'127.0.0.1',port:16432,database:'aia_acreditacao_local'}:mode==='test'?{environment:'test',host:'127.0.0.1',port:16432,database:'aia_acreditacao_test'}:(()=>{throw Error('EXPLICIT_MIGRATION_TARGET_REQUIRED');})();
if(target.environment!==mode)throw Error('MIGRATION_ENVIRONMENT_MISMATCH');
const url=process.env.MIGRATION_DATABASE_URL??(mode==='test'?process.env.TEST_DATABASE_URL:process.env.DATABASE_URL);if(!url)throw Error('MIGRATION_DATABASE_URL_REQUIRED');validateDatabaseTarget(url,target);
if(mode==='production' && (!process.env.MIGRATION_DATABASE_URL || process.env.MIGRATION_DATABASE_URL===process.env.DATABASE_URL))throw Error('SEPARATE_MIGRATION_CREDENTIAL_REQUIRED');
const db=createDatabase(url);
try {
 const exists=await db.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`;
 const applied=exists[0]?.present?await db.$queryRaw<{migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}[]>`SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations`:[];
 if(applied.some(m=>!m.finished_at&&!m.rolled_back_at))throw Error('FAILED_MIGRATION_REQUIRES_MANUAL_RECOVERY');
 const names=(await readdir(new URL('../packages/database/prisma/migrations/',import.meta.url))).filter(n=>/^\d/.test(n)),pending=names.filter(n=>!applied.some(m=>m.migration_name===n&&m.finished_at));
 for(const name of pending){const sql=await readFile(new URL(`../packages/database/prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8');if(/\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE|ALTER\s+COLUMN.+\bTYPE)\b/i.test(sql))throw Error('EXPAND_CONTRACT_REVIEW_REQUIRED');}
 if(pending.length && applied.length){if(!process.env.BACKUP_RECEIPT_FILE)throw Error('VERIFIED_BACKUP_BEFORE_MIGRATION_REQUIRED');const receipt=await verifyBackupReceipt(process.env.BACKUP_RECEIPT_FILE,target);if(Date.now()-new Date(receipt.verifiedAt).getTime()>3600000)throw Error('FRESH_BACKUP_REQUIRED');if(process.env.MIGRATION_COMPATIBILITY_REVIEWED!=='true')throw Error('RUNNING_ARTIFACT_COMPATIBILITY_REVIEW_REQUIRED');}
 if(!applied.length){const rows=await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_tables WHERE schemaname='public'`;if(Number(rows[0]?.count))throw Error('INITIAL_MIGRATION_REQUIRES_EMPTY_TARGET');}
 console.log(JSON.stringify({status:'PREFLIGHT_PASSED',pending:pending.length,environment:mode}));
 if(!process.argv.includes('--preflight') && pending.length){const result=spawnSync('corepack pnpm --filter @aia/database exec prisma migrate deploy',{cwd:root,shell:true,stdio:'inherit',windowsHide:true,env:{...process.env,DATABASE_URL:url}});if(result.status!==0)throw Error('MIGRATION_FAILED_RUNNING_SERVICES_UNCHANGED');}
}finally{await db.$disconnect();}
