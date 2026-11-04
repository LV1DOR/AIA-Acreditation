import { expect, it } from "vitest";
import { monitorEmailText, monitorSender, shouldMonitorSender, classifyEmailFailure } from "../../packages/domain/src/notifications/email-observability.ts";
import { emailEventExplanation } from "../../apps/web/src/lib/email-investigation-copy.ts";
import { sendSingleAuthorizedTest } from "../../packages/email/src/authorized-test.ts";
import { vi } from "vitest";

const smtp = "smtp; 550-5.1.1 The email account that you tried to reach does not exist. https://support.google.com/mail/?p=NoSuchUser";
it("keeps the real SMTP response and explains 5.1.1 without requiring a provider-specific subtype", () => {
  expect(monitorEmailText([smtp])).toBe(smtp);
  expect(classifyEmailFailure("General", null, smtp)).toBe("RECIPIENT_NOT_FOUND");
  expect(emailEventExplanation("en", "RECIPIENT_NOT_FOUND", "BOUNCED").title).toBe("Recipient not found");
  expect(emailEventExplanation("pt", "RECIPIENT_NOT_FOUND", "BOUNCED").title).toBe("Destinatário não encontrado");
});
it("redacts credentials/token parameters, strips controls and caps stored diagnostic sizes", () => {
  const clean=monitorEmailText("\0whsec_abcdefghijklmnop https://example.invalid/?token=sensitive&other=ok Bearer secret.value");
  expect(clean).not.toMatch(/whsec_|sensitive|secret.value|\0/);
  expect(monitorEmailText("x".repeat(9000))?.length).toBe(8000);
});
it("matches the exact verified sender domain rather than display-name or suffix tricks", () => {
  expect(monitorSender("AIA <notificacoes@notify.joinaia.pt>")).toBe("notificacoes@notify.joinaia.pt");
  expect(shouldMonitorSender("AIA <notificacoes@notify.joinaia.pt>", "notify.joinaia.pt")).toBe(true);
  expect(shouldMonitorSender("notify.joinaia.pt <mail@other.invalid>", "notify.joinaia.pt")).toBe(false);
  expect(shouldMonitorSender("mail@notify.joinaia.pt.other.invalid", "notify.joinaia.pt")).toBe(false);
  expect(shouldMonitorSender(undefined, "notify.joinaia.pt")).toBe(false);
});
it("the separate authorised sending test can address only Luke with an idempotency key", async () => {
  const fetch=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({id:"synthetic-id"}),{headers:{"Content-Type":"application/json"}}));
  try {
    expect(await sendSingleAuthorizedTest("synthetic-only","aia-monitor-test/synthetic")).toBe("synthetic-id");
    const request=fetch.mock.calls[0]!;
    expect(String(request[0])).toBe("https://api.resend.com/emails");
    const sent=JSON.parse(String(request[1]?.body));
    expect(sent.to).toEqual(["lukevidor@gmail.com"]);
    expect(sent.from).toContain("notificacoes@notify.joinaia.pt");
    expect(sent).not.toHaveProperty("cc"); expect(sent).not.toHaveProperty("bcc");
    expect(new Headers(request[1]?.headers).get("idempotency-key")).toBe("aia-monitor-test/synthetic");
  } finally {fetch.mockRestore();}
});
