import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { logoContentId } from "../../packages/email/src/layout.tsx";
import { logoBase64 } from "../../packages/email/src/logo.ts";

it("adds only an inline public PNG, preserves plaintext and retains SMTP security", async () => {
  // Resolve from the email workspace itself: pnpm does not promise a root
  // nodemailer alias, and a mock of a different resolution cannot intercept it.
  const emailRequire = createRequire(new URL("../../packages/email/package.json", import.meta.url));
  const nodemailerPath = emailRequire.resolve("nodemailer");
  const sendMail = vi.fn(async (_message: unknown) => ({ accepted: ["synthetic@example.invalid"] }));
  const close = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail, close }));
  vi.resetModules();
  vi.doMock(nodemailerPath, () => ({ default: { createTransport } }));
  const { createSmtpTransport } = await import("../../packages/email/src/index.ts");
  const transport = createSmtpTransport({ host: "smtp.example.invalid", port: 2465, secure: true, from: "sender@example.invalid", user: "synthetic", password: "synthetic-only" });
  // Fail before send if interception failed; never try a real SMTP connection.
  expect(createTransport, "EMAIL_WORKSPACE_SMTP_FACTORY_MUST_BE_MOCKED").toHaveBeenCalledTimes(1);
  try {
    await transport.send({ deliveryId: "a8348fe2-4bc5-4c99-903a-317ac46c972a", to: "synthetic@example.invalid", subject: "Synthetic verification", text: "Unchanged code 123456", html: "<p>Unchanged code 123456</p>" });
  } catch (error) {
    console.info(JSON.stringify({ diagnostic: "MOCKED_SMTP_BRANDING", factoryCalls: createTransport.mock.calls.length,
      sendCalls: sendMail.mock.calls.length, errorType: error instanceof Error ? error.name : "UNKNOWN" }));
    throw error;
  }
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false }));
  expect(sendMail).toHaveBeenCalledTimes(1);
  const sent = sendMail.mock.calls[0]![0] as { text: string; html: string; attachments: { content: Buffer }[]; messageId: string };
  expect(sent.text).toBe("Unchanged code 123456");
  expect(sent.html).toContain(`cid:${logoContentId}`);
  expect(sent.html).toContain("123456");
  expect(sent.attachments).toHaveLength(1);
  expect(sent.attachments[0]).toMatchObject({ contentType: "image/png", contentDisposition: "inline", cid: logoContentId });
  expect(sent.attachments[0]!.content.equals(Buffer.from(logoBase64, "base64"))).toBe(true);
  expect(sent.messageId).toBe("<a8348fe2-4bc5-4c99-903a-317ac46c972a@example.invalid>");
  transport.close();
  expect(close).toHaveBeenCalledTimes(1);
  vi.doUnmock(nodemailerPath);
});
