import { listMonitoredEmails } from "@aia/domain";
import { adminEmailRead } from "../../../../server/email-monitoring-api.ts";
import { database } from "../../../../server/runtime.ts";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return adminEmailRead(context => listMonitoredEmails(database(), context, Object.fromEntries(new URL(request.url).searchParams)));
}
