import { monitoredEmailDetail } from "@aia/domain";
import { adminEmailRead } from "../../../../../server/email-monitoring-api.ts";
import { database } from "../../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminEmailRead(async context => monitoredEmailDetail(database(), context, (await params).id, new URL(request.url).searchParams.get("cursor") ?? undefined));
}
