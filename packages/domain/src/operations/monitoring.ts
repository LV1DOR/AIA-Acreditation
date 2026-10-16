import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";

export {assertRestrictedDatabaseRuntime} from "./database-role.ts";
export async function operationalSignals(db:PrismaClient,options:{backupMaxAgeHours:number;queueMaxAgeMinutes:number},now=new Date()) {
  const [failed,expiredLeases,oldQueued,cleanupFailed,privacyPending,worker,backup,backupFailures,missingPolicies,overdueRecords,overdueEvidence]=await Promise.all([
    db.outboxMessage.count({where:{terminalAt:{not:null},processedAt:null,recoveries:0}}),
    db.outboxMessage.count({where:{processedAt:null,terminalAt:null,leaseExpiresAt:{lt:now}}}),
    db.outboxMessage.count({where:{processedAt:null,terminalAt:null,createdAt:{lt:new Date(now.getTime()-options.queueMaxAgeMinutes*60000)}}}),
    db.storageDeletion.count({where:{status:"RETRYING"}}),db.privacyErasureJob.count({where:{status:{notIn:["COMPLETE","CANCELLED"]}}}),
    db.operationalHeartbeat.findUnique({where:{id:"worker"}}),db.backupRun.findFirst({where:{status:"VERIFIED",deletedAt:null},orderBy:{verifiedAt:"desc"}}),
    db.backupRun.count({where:{status:"FAILED"}}),
    db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "Event" e WHERE NOT EXISTS(SELECT 1 FROM "EventRetentionPolicy" p WHERE p."eventId"=e.id)`,
    db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "CompanyEventRegistration" r WHERE r."erasedAt" IS NULL AND EXISTS(SELECT 1 FROM "EventRetentionPolicy" p WHERE p.id=(SELECT id FROM "EventRetentionPolicy" WHERE "eventId"=r."eventId" ORDER BY "createdAt" DESC,id DESC LIMIT 1) AND p."recordsEraseAfter" < ${now})`,
    db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "CompanyEventRegistration" r WHERE EXISTS(SELECT 1 FROM "EventRetentionPolicy" p WHERE p.id=(SELECT id FROM "EventRetentionPolicy" WHERE "eventId"=r."eventId" ORDER BY "createdAt" DESC,id DESC LIMIT 1) AND p."evidenceEraseAfter" < ${now})`,
  ]);
  const workerAvailable=Boolean(worker && now.getTime()-worker.lastSeenAt.getTime()<30000),backupAgeHours=backup?.verifiedAt?(now.getTime()-backup.verifiedAt.getTime())/3600000:null;
  const alerts:string[]=[];
  if(!workerAvailable)alerts.push("WORKER_HEARTBEAT_MISSING");if(failed)alerts.push("DELIVERY_FAILED");if(expiredLeases)alerts.push("LEASE_EXPIRED");if(oldQueued)alerts.push("QUEUE_TOO_OLD");if(cleanupFailed)alerts.push("STORAGE_CLEANUP_FAILED");
  if(!backup || backupAgeHours!>options.backupMaxAgeHours)alerts.push("BACKUP_MISSING_OR_OLD");if(backupFailures)alerts.push("BACKUP_FAILED");
  if(Number(missingPolicies[0]?.count))alerts.push("RETENTION_POLICY_MISSING");if(Number(overdueRecords[0]?.count)||Number(overdueEvidence[0]?.count))alerts.push("RETENTION_REVIEW_DUE");
  return {alerts,failed,expiredLeases,oldQueued,cleanupFailed,privacyPending,workerAvailable,workerErrors:worker?.errorCount??0,backupAgeHours,backupFailures,missingPolicies:Number(missingPolicies[0]?.count??0),overdueRecords:Number(overdueRecords[0]?.count??0),overdueEvidence:Number(overdueEvidence[0]?.count??0)};
}
export async function adminOperationalSignals(db:PrismaClient,context:ActorContext) {
  requireAdmin(await resolveActor(db,context));return operationalSignals(db,{backupMaxAgeHours:Number(process.env.BACKUP_MAX_AGE_HOURS)||24,queueMaxAgeMinutes:Number(process.env.QUEUE_MAX_AGE_MINUTES)||15});
}
