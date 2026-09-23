import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest } from "next/server";
import { enqueueAuthEmail } from "@aia/domain";
import { database } from "../../../../server/runtime.ts";
export async function POST(request: Request) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  const key = process.env.AUTH_EMAIL_ENCRYPTION_KEY;
  if (!signingSecret || !key) return new Response(null, { status: 503 });
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > 1000000) return new Response(null, { status: 413 });
  // Bound request size before parsing or signature verification.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 1000000) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(part.value);
  }
  let event;
  try {
    event = await verifyWebhook(new NextRequest(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) }), { signingSecret });
  } catch { return new Response(null, { status: 400 }); }
  if (event.type !== "email.created") return new Response(null, { status: 204 });
  // Do not duplicate messages still delivered by Clerk.
  if (event.data.delivered_by_clerk) return new Response(null, { status: 204 });
  try {
    await enqueueAuthEmail(database(), {
      eventId: event.data.id,
      recipient: event.data.to_email_address ?? "",
      subject: event.data.subject ?? "",
      text: event.data.body_plain ?? "",
      html: event.data.body ?? "",
    }, key);
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 503 }); }
}
