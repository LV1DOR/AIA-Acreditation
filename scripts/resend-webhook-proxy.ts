import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// A public testing tunnel reaches only this narrow forwarding service, never
// the development portal, source maps, sign-in pages or other API routes.
export function createResendWebhookProxy(targetOrigin = "http://127.0.0.1:3100") {
  const target = new URL(targetOrigin);
  if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname) || target.port !== "3100" || target.pathname !== "/") throw new Error("LOCAL_WEBHOOK_TARGET_REQUIRED");
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method !== "POST" || request.url !== "/api/webhooks/resend") { response.writeHead(404).end(); return; }
    const limit = 1_000_000;
    if (Number(request.headers["content-length"]) > limit) { response.writeHead(413).end(); request.resume(); return; }
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > limit) { response.writeHead(413).end(); request.resume(); return; }
        chunks.push(bytes);
      }
      const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3100" };
      for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
        const value = request.headers[name]; if (typeof value === "string") headers[name] = value;
      }
      const upstream = await fetch(new URL("/api/webhooks/resend", target), {
        method: "POST", headers, body: Buffer.concat(chunks), redirect: "manual", signal: AbortSignal.timeout(15000),
      });
      const retry = upstream.headers.get("retry-after"); if (retry && /^\d{1,4}$/.test(retry)) response.setHeader("Retry-After", retry);
      // The ingestion endpoint returns no content. Do not proxy unexpected HTML
      // or request headers back through this public diagnostic endpoint.
      await upstream.body?.cancel(); response.writeHead(upstream.status).end();
    } catch { if (!response.headersSent) response.writeHead(503).end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createResendWebhookProxy();
  server.listen(3315, "127.0.0.1", () => console.log("RESEND_WEBHOOK_PROXY_READY"));
  server.on("error", () => { console.error("RESEND_WEBHOOK_PROXY_FAILED"); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close());
}
