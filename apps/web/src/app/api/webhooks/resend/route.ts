import { verifyResendWebhook } from "@aia/email/resend";
import { emailMetadataHash, parseResendEvent, persistResendEvent } from "@aia/domain";
import { database } from "../../../../server/runtime.ts";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503, headers });
  const maxBytes = 1_000_000;
  if (Number(request.headers.get("content-length")) > maxBytes) return new Response(null, { status: 413, headers });
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      chunks.push(part.value);
    }
    // Fatal UTF-8 decoding preserves the exact signed text; never JSON.stringify.
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch { return new Response(null, { status: 400, headers }); }
  let event;
  try { event = parseResendEvent(verifyResendWebhook(raw, request.headers, secret)); }
  catch { return new Response(null, { status: 400, headers }); }
  if (!event) return new Response(null, { status: 204, headers });
  const eventId = request.headers.get("svix-id") ?? "";
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(eventId)) return new Response(null, { status: 400, headers });
  try {
    await persistResendEvent(database(), event, eventId, emailMetadataHash(raw));
    return new Response(null, { status: 204, headers });
  } catch {
    // Fixed diagnostic only: no payloads, recipients, signing material or DB errors.
    console.error(JSON.stringify({ code: "RESEND_WEBHOOK_PERSISTENCE_FAILED", webhookEventId: eventId }));
    return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
