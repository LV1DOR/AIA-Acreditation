export type Target={environment:"local"|"test"|"staging"|"production";host:string;port:number;database:string};
export function validateDatabaseTarget(value:string,target:Target) {
  if(!["local","test","staging","production"].includes(target.environment))throw new Error("INVALID_DEPLOYMENT_TARGET");
  const u=new URL(value);
  if(!["postgres:","postgresql:"].includes(u.protocol) || u.hostname!==target.host || Number(u.port||5432)!==target.port || decodeURIComponent(u.pathname.slice(1))!==target.database)throw new Error("DATABASE_TARGET_MISMATCH");
  if(target.environment==="local" && (!['localhost','127.0.0.1'].includes(u.hostname) || u.port!=="16432" || target.database!=="aia_acreditacao_local"))throw new Error("LOCAL_DATABASE_TARGET_REQUIRED");
  if(target.environment==="test" && (!['localhost','127.0.0.1'].includes(u.hostname) || !((u.port==="16432" && target.database==="aia_acreditacao_test") || (u.port==="16433" && /^aia_phase3_(source|restore|shadow)$/.test(target.database)))))throw new Error("ISOLATED_DATABASE_TARGET_REQUIRED");
  if(target.environment==="production" && (!u.username || /postgres|local/i.test(u.username) || u.searchParams.get("sslmode")!=="verify-full"))throw new Error("PRODUCTION_DATABASE_TARGET_REQUIRED");
  return u;
}
export async function releaseSequence<T>(steps:{validate:()=>Promise<void>;build:()=>Promise<T>;backup:()=>Promise<void>;migrationPreflight:()=>Promise<void>;migrate:()=>Promise<void>;activate:(candidate:T)=>Promise<void>;health:()=>Promise<void>;rollback:()=>Promise<void>}) {
  await steps.validate();const candidate=await steps.build();await steps.backup();await steps.migrationPreflight();await steps.migrate();
  try{await steps.activate(candidate);await steps.health();}catch{await steps.rollback();throw new Error("RELEASE_ACTIVATION_FAILED_SCHEMA_REQUIRES_FORWARD_REVIEW");}
  return candidate;
}
