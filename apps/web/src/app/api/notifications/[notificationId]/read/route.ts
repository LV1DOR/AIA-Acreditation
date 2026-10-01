import { markNotificationRead } from "@aia/domain";
import { z } from "zod";
import { session } from "../../../../../server/session.ts";
import { database } from "../../../../../server/runtime.ts";

const notificationIdSchema = z.uuid();

export async function POST(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const access = await session();
  if (access.status !== "GRANTED") return new Response(null, { status: 401 });
  const parsed = notificationIdSchema.safeParse((await params).notificationId);
  if (!parsed.success) return new Response(null, { status: 400 });
  await markNotificationRead(database(), access.context, parsed.data);
  return new Response(null, { status: 204 });
}
