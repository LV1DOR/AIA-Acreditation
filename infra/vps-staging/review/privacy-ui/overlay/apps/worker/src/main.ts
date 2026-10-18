import { drainTasks } from "./drain.ts";
import { config } from "dotenv";
import { createDatabase } from "@aia/database";
import { createLogger, parseEnv, parseAuthEnv, parseStorageEnv, deploymentMode } from "@aia/config";
import { cleanupNextPhotoUpload, deliverNextAuthEmail, deliverNextBusinessEmail, enqueueDueDeadlineReminders, publishNextInvalidation, reconcileExpiredDeliveryLeases, cleanupNextStorageDeletion, executePrivacyDatabaseErasure, reconcilePrivacyErasure, executePrivacyEvidenceExpiry, assertRestrictedDatabaseRuntime, cleanupExpiredCommunicationMetadata, COMMUNICATION_CLEANUP_INTERVAL_MS } from "@aia/domain";
import { createObjectStorage } from "@aia/storage/objects";
import { createSmtpTransport } from "@aia/email";
import { createClerkClient } from "@clerk/backend";
import Redis from "ioredis";
import { healthServer } from "./health.ts";
config({ path: "../../.env", quiet: true });
const logger = createLogger();
async function main() {
  const env = parseEnv(process.env);
  const authEnv = parseAuthEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);
  const storageEnv = parseStorageEnv(process.env);
  const photoStorage = createObjectStorage({ endpoint: storageEnv.MINIO_ENDPOINT, accessKey: storageEnv.MINIO_ACCESS_KEY, secretKey: storageEnv.MINIO_SECRET_KEY, region: storageEnv.MINIO_REGION, bucket: storageEnv.MINIO_PHOTOS_BUCKET });
  await db.$queryRaw`SELECT 1`;
  if(deploymentMode()==="production")await assertRestrictedDatabaseRuntime(db);
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on("error", () => logger.error("DEPENDENCY_UNAVAILABLE"));
  await redis.connect();
  let stopping=false;
  const server = healthServer(db, () => redis.status === "ready" && !stopping,()=>photoStorage.checkReady(deploymentMode()==="production"));
  server.on("error", () => { logger.error("STARTUP_FAILED"); void db.$disconnect().finally(() => process.exit(1)); });
  server.listen(env.WORKER_HEALTH_PORT, env.WORKER_HEALTH_HOST, () => logger.info("WORKER_STARTED"));
  const transport = createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.SMTP_FROM, user: env.SMTP_USER, password: env.SMTP_PASSWORD });
  const clerk = authEnv.CLERK_SECRET_KEY ? createClerkClient({ secretKey: authEnv.CLERK_SECRET_KEY }) : null;
  const resolveEmail = async (clerkUserId: string) => {
    if (!clerk) throw new Error("AUTH_NOT_CONFIGURED");
    const user = await clerk.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId && item.verification?.status === "verified");
    const verified = primary ?? user.emailAddresses.find(item => item.verification?.status === "verified");
    if (!verified) throw new Error("RECIPIENT_UNAVAILABLE");
    return verified.emailAddress;
  };
  const inFlight=new Set<Promise<unknown>>();
  const track=(work:()=>Promise<unknown>)=>{if(stopping)return;const p=work().catch(()=>logger.error("DEPENDENCY_UNAVAILABLE"));inFlight.add(p);void p.finally(()=>inFlight.delete(p));};
  let errorDelta=0;
  const checked=async(p:Promise<unknown>)=>{const result=await p;if(result==="FAILED"||result==="RETRY"||result==="UNCERTAIN"){errorDelta++;logger.error("DELIVERY_FAILED");}return result;};
  let busy = false, reminderBusy = false;
  const timer = setInterval(() => track(async () => {
    if (busy) return;
    busy = true;
    try {
      await reconcileExpiredDeliveryLeases(db);
      await checked(publishNextInvalidation(db, message => redis.publish("aia:acreditacao:portal-invalidation", message)));
      if (authEnv.AUTH_EMAIL_ENCRYPTION_KEY) await checked(deliverNextAuthEmail(db, transport, authEnv.AUTH_EMAIL_ENCRYPTION_KEY));
      if (clerk) await checked(deliverNextBusinessEmail(db, transport, authEnv.APP_ORIGIN, resolveEmail));
    }
    catch { logger.error("DEPENDENCY_UNAVAILABLE"); }
    finally { busy = false; await db.operationalHeartbeat.upsert({where:{id:"worker"},create:{id:"worker",lastSeenAt:new Date(),errorCount:errorDelta},update:{lastSeenAt:new Date(),errorCount:{increment:errorDelta},...(errorDelta?{lastErrorCode:"DELIVERY_FAILED"}:{})}});errorDelta=0; }
  }), 1000);
  let cleanupBusy = false;
  const cleanupTimer = setInterval(() => track(async () => {
    if (cleanupBusy) return;
    cleanupBusy = true;
    try {
      const result = await cleanupNextPhotoUpload(db, (bucket, key) => {
        if (bucket !== storageEnv.MINIO_PHOTOS_BUCKET) throw new Error("STORAGE_SCOPE_MISMATCH");
        return photoStorage.deletePhoto(key);
      });
      if (result === "RETRY") {errorDelta++;logger.error("CLEANUP_FAILED");}
      await checked(cleanupNextStorageDeletion(db,(bucket,key)=>{if(bucket!==storageEnv.MINIO_PHOTOS_BUCKET)throw new Error("STORAGE_SCOPE_MISMATCH");return photoStorage.erasePhotoAndVerify(key);}));
    } catch { logger.error("DEPENDENCY_UNAVAILABLE"); }
    finally { cleanupBusy = false; }
  }), 1000);
  const reminders = setInterval(() => track(async () => {
    if (reminderBusy) return;
    reminderBusy = true;
    try { await enqueueDueDeadlineReminders(db); } catch { logger.error("DEPENDENCY_UNAVAILABLE"); } finally { reminderBusy = false; }
  }), 300000);
  track(()=>enqueueDueDeadlineReminders(db));
  // Routine metadata cleanup is server-managed and only uses approved policies.
  let communicationCleanupBusy=false;
  const communicationCleanup=()=>track(async()=>{
    if(communicationCleanupBusy)return;communicationCleanupBusy=true;
    try{
      await cleanupExpiredCommunicationMetadata(db);
      await db.operationalHeartbeat.upsert({where:{id:"communication-cleanup"},create:{id:"communication-cleanup",lastSeenAt:new Date(),errorCount:0},update:{lastSeenAt:new Date(),errorCount:0,lastErrorCode:null}});
    }
    catch{
      errorDelta++;logger.error("COMMUNICATION_CLEANUP_FAILED");
      await db.operationalHeartbeat.upsert({where:{id:"communication-cleanup"},create:{id:"communication-cleanup",lastSeenAt:new Date(),errorCount:1,lastErrorCode:"COMMUNICATION_CLEANUP_FAILED"},update:{lastSeenAt:new Date(),errorCount:1,lastErrorCode:"COMMUNICATION_CLEANUP_FAILED"}});
    }
    finally{communicationCleanupBusy=false;}
  });
  const communicationCleanupTimer=setInterval(communicationCleanup,COMMUNICATION_CLEANUP_INTERVAL_MS);
  // First run is after the interval, allowing deployment health checks to finish.
  // Privacy credentials are separate from the normal runtime. No queued job exists without explicit ADMIN authorisation.
  const executor=process.env.PRIVACY_DATABASE_URL?createDatabase(process.env.PRIVACY_DATABASE_URL):null;
  let privacyBusy=false;
  const privacyTimer=setInterval(()=>track(async()=>{if(privacyBusy)return;privacyBusy=true;try{if(executor){const j=await db.privacyErasureJob.findFirst({where:{databaseErasedAt:null,status:"QUEUED"},orderBy:{createdAt:"asc"}});if(j)try{await executePrivacyDatabaseErasure(executor,j.id);}catch{await db.privacyErasureJob.update({where:{id:j.id},data:{lastFailureCode:"DATABASE_ERASURE_FAILED",attempts:{increment:1}}});logger.error("CLEANUP_FAILED");}}if(executor){const expired=await db.privacyErasureJob.findFirst({where:{status:"COMPLETE",evidencePurgeRequestedAt:{not:null}},orderBy:{createdAt:"asc"}});if(expired)await executePrivacyEvidenceExpiry(executor,expired.id);}
    const jobs=await db.privacyErasureJob.findMany({where:{databaseErasedAt:{not:null},status:{not:"COMPLETE"}},take:50});for(const j of jobs)await reconcilePrivacyErasure(db,j.id);}finally{privacyBusy=false;}}),5000);
  const shutdown=()=>{if(stopping)return;stopping=true;clearInterval(timer);clearInterval(reminders);clearInterval(cleanupTimer);clearInterval(privacyTimer);clearInterval(communicationCleanupTimer);server.close();void (async()=>{const drained=await drainTasks(inFlight,45000);if(!drained)logger.error("SHUTDOWN_TIMEOUT");transport.close();redis.disconnect();await executor?.$disconnect();await db.$disconnect();logger.info("WORKER_STOPPED");process.exit(drained?0:1);})();};
  for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,shutdown);
  process.on("message",message=>{if(message==="shutdown")shutdown();});
}
main().catch(()=>{logger.error("STARTUP_FAILED");process.exit(1);});
