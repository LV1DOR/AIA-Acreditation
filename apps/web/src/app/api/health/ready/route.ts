import {deploymentMode} from "@aia/config";
import {assertRestrictedDatabaseRuntime} from "@aia/domain";
import {checkRedisReady} from "@/server/operational-metrics.ts";
import { database } from "../../../../server/runtime";
import { authConfiguration } from "../../../../server/auth-config";
import { objectStorage, storageConfiguration } from "../../../../server/storage";
export const dynamic = "force-dynamic";
export async function GET() {
  if (authConfiguration().status !== "READY") {
    return Response.json({ status: "unavailable", dependency: "authentication" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (storageConfiguration().status !== "READY") {
    return Response.json({ status: "unavailable", dependency: "object-storage" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await database().$queryRaw`SELECT 1`;
    if(deploymentMode()==="production")await assertRestrictedDatabaseRuntime(database());
    if((await database().operationalHeartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount)throw new Error("RESTORE_QUARANTINED");
  } catch {
    return Response.json({ status: "unavailable", dependency: "database" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await objectStorage().checkReady(deploymentMode()==="production");
    await checkRedisReady();
  } catch {
    return Response.json({ status: "unavailable", dependency: "object-storage" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
}
