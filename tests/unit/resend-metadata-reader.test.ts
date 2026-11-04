import { expect, it, vi } from "vitest";
import { resendMetadataReader } from "../../packages/email/src/resend.ts";

it("reconciliation uses only the metadata list API and discards provider bodies and arbitrary fields", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ has_more: false, data: [{ id: "synthetic-id", message_id: "<synthetic@example.invalid>", to: ["synthetic@example.invalid"], created_at: "2026-11-04T10:00:00.000Z", last_event: "delivered", html: "PRIVATE_BODY", text: "PRIVATE_BODY", subject: "PRIVATE_SUBJECT" }] }), { headers: { "Content-Type": "application/json" } }));
  try {
    const data = await resendMetadataReader("synthetic-only")("after-id");
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.resend.com/emails?limit=100&after=after-id");
    expect(fetch.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE_BODY|html|text|synthetic-only/);
    expect(data.messages[0]?.subject).toBe("PRIVATE_SUBJECT");
    expect(data.messages[0]?.status).toBe("delivered");
  } finally { fetch.mockRestore(); }
});
