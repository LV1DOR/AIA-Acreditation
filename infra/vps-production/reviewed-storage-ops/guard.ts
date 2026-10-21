import {createDatabase} from '../packages/database/src/index.ts';
export const project='aia-accreditation-production', databaseName='aia_accreditation_production', bucket='aia-accreditation-production-photos';
export function check(ok:unknown,code:string):asserts ok {if(!ok)throw Error(code);}
export function target(value:string|undefined,user?:string,dbName=databaseName){
  check(process.env.DEPLOYMENT_ENV==='production','PRODUCTION_INTENT_REQUIRED');
  const u=new URL(value??'');check(u.hostname==='postgres'&&u.port==='5432'&&u.pathname==='/'+dbName&&u.searchParams.get('sslmode')==='verify-full'&&(!user||u.username===user),'PRODUCTION_TARGET_MISMATCH');return u;
}
export async function marked(db:ReturnType<typeof createDatabase>){
  const rows=await db.$queryRaw<{marker:string|null}[]>`SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()`;
  check(rows[0]?.marker===project+'-fresh-only','PRODUCTION_DATABASE_MARKER_MISMATCH');
}
export async function safe(work:()=>Promise<void>){try{await work();}catch(e){const code=e instanceof Error&&/^[A-Z0-9_]{4,100}$/.test(e.message)?e.message:'OPERATION_FAILED_DETAILS_SUPPRESSED';console.error(JSON.stringify({passed:false,code}));process.exitCode=1;}}
