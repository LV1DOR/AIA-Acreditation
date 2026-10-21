import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { businessEmailTemplate, renderBusinessEmail, renderInvitationEmail } from "../../packages/email/src/index.ts";
import { brandEmailHtml, logoContentId } from "../../packages/email/src/layout.tsx";
import { logoBase64 } from "../../packages/email/src/logo.ts";

it("embeds exactly the same original artwork as the portal and public header", () => {
  const original = readFileSync(new URL("../../apps/web/public/brand/aia-logo.png", import.meta.url));
  expect(Buffer.from(logoBase64, "base64").equals(original)).toBe(true);
  for (const name of ["public-header", "portal-shell"]) {
    expect(readFileSync(new URL(`../../apps/web/src/components/${name}.tsx`, import.meta.url), "utf8")).toContain("<BrandLogo");
  }
});

it.each(businessEmailTemplate.options)("brands %s with both languages and a working fallback", async template => {
  const url = "https://example.invalid/portal?event=synthetic&view=review";
  const email = await renderBusinessEmail(template, { companyName: "Synthetic <Company>", eventName: "Synthetic Event", appUrl: url, deadline: "Tomorrow", reason: "<script>untrusted</script>" });
  expect(email.html).toContain(`cid:${logoContentId}`);
  expect(email.html).toContain('lang="en"');
  expect(email.html).toContain("If the button does not work");
  expect(email.html).toContain("&lt;script&gt;");
  expect(email.html).not.toContain("<script>");
  expect(email.text).toContain("example.invalid/portal");
  expect(email.text).toContain("Synthetic Event");
});

it.each(["pt", "en"] as const)("renders a complete %s invitation retaining the exact capability", async locale => {
  const url = "https://example.invalid/api/invitations/start?locale=" + locale + "&token=synthetic-only";
  const email = await renderInvitationEmail({ companyName: "<Synthetic & Co>", locale, url, expiresAt: new Date("2030-01-01T12:00:00Z") });
  expect(email.html).toContain(`cid:${logoContentId}`);
  expect(email.html).toContain("&lt;Synthetic &amp; Co&gt;");
  expect(email.text).toContain(url);
  expect(email.html).toContain("UTC");
  expect(email.text).toContain("UTC");
  expect(email.html).not.toContain("<Synthetic");
});

it("wraps verified provider HTML once and preserves verification links/codes", async () => {
  const body = '<!doctype html><html><head><title>Verification</title></head><body><p>123456</p><a href="https://example.invalid/verify?ticket=synthetic">Verify</a></body></html>';
  const html = await brandEmailHtml(body, "Verify <account>");
  expect(html).toContain("123456");
  expect(html).toContain('href="https://example.invalid/verify?ticket=synthetic"');
  expect(html).toContain("Verify &lt;account&gt;");
  expect((html.match(/<html[ >]/g) ?? []).length).toBe(1);
  expect(await brandEmailHtml(html, "same")).toBe(html);
});
