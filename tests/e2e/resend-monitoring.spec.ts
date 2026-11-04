import { expect, test } from "@playwright/test";
import { Webhook } from "standardwebhooks";

test("Resend webhook is public, verifies signatures without browser Origin/session, and Admin reads fail closed", async ({ request, page }) => {
  const invalid = await request.post("/api/webhooks/resend", { data: "{}", maxRedirects: 0 });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers().location).toBeUndefined();
  const body = JSON.stringify({ type: "email.opened", created_at: new Date().toISOString(), data: {} });
  const id = "msg_synthetic_public_probe", timestamp = new Date();
  const secret = "whsec_" + Buffer.from("synthetic-playwright-resend-only").toString("base64");
  const valid = await request.post("/api/webhooks/resend", { data: body, maxRedirects: 0, headers: {
    "svix-id": id, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(id, timestamp, body),
  } });
  expect(valid.status()).toBe(204);
  for (const url of ["/api/admin/emails", "/api/admin/emails/11111111-1111-4111-8111-111111111111"]) {
    const response = await request.get(url);
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  for (const locale of ["pt", "en"]) {
    await page.goto(`/${locale}/admin/emails`);
    expect(new URL(page.url()).pathname).toBe(`/${locale}/sign-in`);
    await expect(page.getByRole("table")).toHaveCount(0);
  }
});
