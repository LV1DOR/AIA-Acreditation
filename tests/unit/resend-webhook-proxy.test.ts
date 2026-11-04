import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { createResendWebhookProxy } from "../../scripts/resend-webhook-proxy.ts";
it("public tunnel forwards only the exact webhook path and preserves signed bytes without browser credentials", async () => {
  const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(null,{status:204}));
  const server=createResendWebhookProxy(); await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const port=(server.address() as AddressInfo).port;
  const send=(path:string,body="",method="POST")=>new Promise<number>((resolve,reject)=>{
    const request=httpRequest({hostname:"127.0.0.1",port,path,method,headers:{"svix-id":"msg_test","svix-signature":"synthetic-signature",cookie:"private-cookie",authorization:"private-authorization"}},response=>{response.resume();response.on("end",()=>resolve(response.statusCode!));});request.on("error",reject);request.end(body);
  });
  try {
    expect(await send("/api/admin/emails","","GET")).toBe(404);
    expect(await send("/api/webhooks/resend?bypass=1","{}")).toBe(404);
    const raw='{\n  "type" : "email.sent"\n}';
    expect(await send("/api/webhooks/resend",raw)).toBe(204);
    expect(fetch).toHaveBeenCalledTimes(1);
    const forwarded=fetch.mock.calls[0]![1]!;
    expect(Buffer.from(forwarded.body as Uint8Array).toString()).toBe(raw);
    const headers=new Headers(forwarded.headers);
    expect(headers.has("cookie")).toBe(false); expect(headers.has("authorization")).toBe(false);
    expect(headers.get("svix-signature")).toBe("synthetic-signature");
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fetch.mockRestore();}
});
