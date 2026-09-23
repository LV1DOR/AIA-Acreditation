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
  } catch {
    return Response.json({ status: "unavailable", dependency: "database" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await objectStorage().ensureBucket();
  } catch {
    return Response.json({ status: "unavailable", dependency: "object-storage" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
}
