import {parseEnv,parseAuthEnv,parseStorageEnv} from '../packages/config/src/index.ts';
import {createDatabase} from '../packages/database/src/index.ts';
import {assertRestrictedDatabaseRuntime} from '../packages/domain/src/operations/database-role.ts';
import {check,target,marked,safe} from './guard.ts';
await safe(async()=>{
  const e=parseEnv(process.env);parseAuthEnv(process.env);parseStorageEnv(process.env);target(e.DATABASE_URL,'aia_web');
  check(process.env.APP_ORIGIN==='https://app.joinaia.pt','APP_ORIGIN_MISMATCH');
  const db=createDatabase(e.DATABASE_URL);try{await marked(db);await assertRestrictedDatabaseRuntime(db);console.log(JSON.stringify({passed:true,restrictedRuntime:true}));}finally{await db.$disconnect();}
});
