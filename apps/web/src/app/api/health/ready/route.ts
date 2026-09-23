import { database } from "../../../../server/runtime";
import { authConfiguration } from "../../../../server/auth-config";
export const dynamic = "force-dynamic";
export async function GET() {
  if (authConfiguration().status !== "READY") {
    return Response.json({ status: "unavailable", dependency: "authentication" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await database().$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
