// A local Next build also uses NODE_ENV=production; deployment intent is separate.
export function deploymentMode(input: Record<string,string|undefined> = process.env) {
  const mode=input.DEPLOYMENT_ENV ?? (input.NODE_ENV==="test"?"test":"local");
  if(!["local","test","staging","production"].includes(mode)) throw new Error("INVALID_DEPLOYMENT_TARGET");
  return mode;
}
export function syntheticMode(input:Record<string,string|undefined> = process.env) {
  const mode=deploymentMode(input);
  return mode!=="production" && (mode==="test" || input.AIA_SYNTHETIC_DATA==="true");
}
export function productionConfigurationIssues(input:Record<string,string|undefined>) {
  if(deploymentMode(input)!=="production") return [];
  const issues:string[]=[];
  const require=(ok:unknown,code:string)=>{if(!ok)issues.push(code);};
  const https=(value:string|undefined)=>{try{const u=new URL(value!);return u.protocol==="https:" && !["localhost","127.0.0.1"].includes(u.hostname) && !/\.(invalid|example)$/.test(u.hostname);}catch{return false;}};
  require(input.NODE_TLS_REJECT_UNAUTHORIZED!=="0" && !input.CLERK_TESTING_TOKEN && !input.DEBUG,"DEVELOPMENT_BYPASS_FORBIDDEN");
  require(input.AIA_SYNTHETIC_DATA!=="true","SYNTHETIC_PRODUCTION_FORBIDDEN");
  require(https(input.APP_ORIGIN),"HTTPS_ORIGIN_REQUIRED");
  require(input.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") && input.CLERK_SECRET_KEY?.startsWith("sk_live_") && input.CLERK_WEBHOOK_SIGNING_SECRET?.startsWith("whsec_"),"LIVE_CLERK_REQUIRED");
  require(!input.AUTH_ADDITIONAL_ORIGINS || input.AUTH_ADDITIONAL_ORIGINS.split(",").every(x=>x.trim()===input.APP_ORIGIN),"UNAPPROVED_ORIGIN");
  require(input.CLERK_PRODUCTION_REVIEWED==="true","CLERK_CONFIGURATION_REVIEW_REQUIRED");
  require(input.SMTP_USER && input.SMTP_PASSWORD && (input.SMTP_SECURE==="true" || input.SMTP_REQUIRE_TLS==="true") && input.SMTP_SENDER_VERIFIED==="true" && !input.SMTP_FROM?.endsWith(".invalid"),"VERIFIED_TLS_SMTP_REQUIRED");
  try {const u=new URL(input.REDIS_URL!);require(u.protocol==="rediss:" && u.password,"AUTHENTICATED_TLS_REDIS_REQUIRED");}catch{issues.push("AUTHENTICATED_TLS_REDIS_REQUIRED");}
  require(https(input.MINIO_ENDPOINT) && input.MINIO_PRIVATE_BUCKET_VERIFIED==="true" && input.MINIO_SCOPED_CREDENTIAL_VERIFIED==="true","PRIVATE_TLS_STORAGE_REQUIRED");
  try {const u=new URL(input.DATABASE_URL!);require(u.searchParams.get("sslmode")==="verify-full" && u.password && !/postgres|acreditacao_local/.test(decodeURIComponent(u.username)),"RESTRICTED_TLS_DATABASE_REQUIRED");const test=input.TEST_DATABASE_URL?new URL(input.TEST_DATABASE_URL):null;require(!/aia_acreditacao_(test|local)/.test(u.pathname) && (!test || [test.hostname,test.port,test.pathname].join("|")!==[u.hostname,u.port,u.pathname].join("|")),"TEST_DATABASE_SEPARATION_REQUIRED");}catch{issues.push("RESTRICTED_TLS_DATABASE_REQUIRED");}
  require(input.AIA_PROXY_SECRET && input.AIA_PROXY_SECRET.length>=32 && input.PRIVATE_INGRESS_VERIFIED==="true","PRIVATE_INGRESS_REQUIRED");
  const keys=[input.DOCUMENT_ENCRYPTION_KEY,input.DOCUMENT_FINGERPRINT_KEY,input.AUTH_EMAIL_ENCRYPTION_KEY];
  require(keys.every(k=>k && /^[a-f0-9]{64}$/i.test(k) && new Set(k).size>=8) && new Set(keys).size===3 && input.SECRET_CUSTODY_VERIFIED==="true","DISTINCT_MANAGED_KEYS_REQUIRED");
  require(input.AIA_PRIVACY_CONFIGURATION_APPROVED==="true","APPROVED_PRIVACY_CONFIGURATION_REQUIRED");
  require(input.AUTH_METADATA_POLICY_REFERENCE && input.AUTH_METADATA_POLICY_REFERENCE.length>=5 && Number.isFinite(Date.parse(input.AUTH_METADATA_ERASE_BEFORE??"")),"AUTH_METADATA_POLICY_REQUIRED");
  require(input.BACKUP_CONFIGURATION_APPROVED==="true" && Number(input.BACKUP_MAX_AGE_HOURS)>0,"BACKUP_CONFIGURATION_REQUIRED");
  return issues;
}
export function assertProductionConfiguration(input:Record<string,string|undefined>) {
  if(productionConfigurationIssues(input).length) throw new Error("INVALID_PRODUCTION_CONFIGURATION");
}
