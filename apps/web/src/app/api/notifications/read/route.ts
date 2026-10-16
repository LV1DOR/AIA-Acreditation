import { markNotificationsRead } from "@aia/domain";
import { session } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";
import { hasTrustedMutationOrigin } from "../../../../server/request-origin.ts";

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return new Response(null, { status: 403 });
  const access = await session();
  if (access.status !== "GRANTED") return new Response(null, { status: 401 });
  await markNotificationsRead(database(), access.context);
  return new Response(null, { status: 204 });
}
