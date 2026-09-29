import Redis from "ioredis";
import { parseEnv } from "@aia/config";
import { session } from "../../../server/session.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const channel = "aia:acreditacao:portal-invalidation";

export async function GET(request: Request) {
  const access = await session();
  if (access.status !== "GRANTED") return new Response(null, { status: 401 });
  const redis = new Redis(parseEnv(process.env).REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  try { await redis.connect(); await redis.subscribe(channel); }
  catch { redis.disconnect(); return new Response("Realtime unavailable", { status: 503 }); }
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => { clearInterval(heartbeat); redis.disconnect(); try { controller.close(); } catch { return; } };
      redis.on("message", (_channel, message) => controller.enqueue(encoder.encode(`event: invalidate\ndata: ${message}\n\n`)));
      redis.on("error", close);
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 20000);
    },
    cancel() { clearInterval(heartbeat); redis.disconnect(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
