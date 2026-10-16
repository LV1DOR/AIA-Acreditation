import {config} from "dotenv";
import {createDatabase} from "../packages/database/src/index.ts";
import {validateDatabaseTarget} from "./lib/targets.ts";
import {readdir,readFile} from "node:fs/promises";
import {deploymentMode} from "../packages/config/src/deployment-env.ts";
config({quiet:true});
if(deploymentMode()!=="local")throw new Error("LOCAL_SERVICE_COMMAND_ONLY");
validateDatabaseTarget(process.env.DATABASE_URL!,{environment:"local",host:"127.0.0.1",port:16432,database:"aia_acreditacao_local"});
if(process.env.TEST_DATABASE_URL===process.env.DATABASE_URL)throw new Error("DATABASE_TARGET_COLLISION");
if(process.argv.includes("--target-only")){console.log("PASS: local database identity guard; no changes");}
else {
  const db=createDatabase(process.env.DATABASE_URL!);
  try {
    const exists=await db.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`;
    const applied=exists[0]?.present?await db.$queryRaw<{migration_name:string;finished_at:Date|null;rolled_back_at:Date|null}[]>`SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations`:[];
    if(applied.some(m=>!m.finished_at && !m.rolled_back_at))throw new Error("FAILED_MIGRATION_REQUIRES_MANUAL_RECOVERY");
    const names=(await readdir('packages/database/prisma/migrations')).filter(n=>/^\d/.test(n));
    const pending=names.filter(n=>!applied.some(m=>m.migration_name===n&&m.finished_at));
    for(const name of pending){const sql=await readFile(`packages/database/prisma/migrations/${name}/migration.sql`,'utf8');if(/\b(DROP\s+(TABLE|COLUMN|SCHEMA)|TRUNCATE|ALTER\s+COLUMN.+\bTYPE)\b/i.test(sql))throw new Error("MIGRATION_REQUIRES_EXPAND_CONTRACT_REVIEW");}
    if(applied.length && pending.length){const run=await db.backupRun.findFirst({where:{status:"VERIFIED",deletedAt:null,verifiedAt:{gt:new Date(Date.now()-3600000)}},orderBy:{verifiedAt:"desc"}}).catch(()=>null);if(!run)throw new Error("VERIFIED_BACKUP_BEFORE_MIGRATION_REQUIRED");}
    console.log(`PASS: migration preflight; ${pending.length} pending; no migrations executed`);
  }finally{await db.$disconnect();}
}
