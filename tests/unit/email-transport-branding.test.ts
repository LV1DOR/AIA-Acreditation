import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { prepareSmtpMessage, smtpTransportOptions } from "../../packages/email/src/index.ts";
import { logoContentId } from "../../packages/email/src/layout.tsx";
import { logoBase64 } from "../../packages/email/src/logo.ts";

it("serializes branded mail with real Nodemailer JSON transport and no SMTP connection", async () => {
  const emailRequire = createRequire(new URL("../../packages/email/package.json", import.meta.url));
  const nodemailer = emailRequire("nodemailer") as {
    createTransport(options: { jsonTransport: true }): {
      sendMail(message: Awaited<ReturnType<typeof prepareSmtpMessage>>): Promise<{ message: string | Buffer }>;
      close(): void;
    };
  };
  const prepared = await prepareSmtpMessage({ deliveryId: "a8348fe2-4bc5-4c99-903a-317ac46c972a", to: "synthetic@example.invalid", subject: "Synthetic verification", text: "Unchanged code 123456", html: "<p>Unchanged code 123456</p>" }, "sender@example.invalid");
  const transport = nodemailer.createTransport({ jsonTransport: true });
  try {
    const info = await transport.sendMail(prepared);
    const sent = JSON.parse(info.message.toString());
    expect(sent.text).toBe("Unchanged code 123456");
    expect(sent.html).toContain(`cid:${logoContentId}`);
    expect(sent.html).toContain("123456");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({ contentType: "image/png", contentDisposition: "inline", cid: logoContentId, encoding: "base64" });
    expect(Buffer.from(sent.attachments[0].content, "base64").equals(Buffer.from(logoBase64, "base64"))).toBe(true);
    expect(sent.messageId).toBe("<a8348fe2-4bc5-4c99-903a-317ac46c972a@example.invalid>");
  } finally { transport.close(); }
});

it("keeps SMTP TLS, credentials and content-access restrictions unchanged", () => {
  const raw = { host: "smtp.example.invalid", port: 2465, secure: true, from: "sender@example.invalid", user: "synthetic", password: "synthetic-only" };
  expect(smtpTransportOptions(raw)).toMatchObject({ secure: true, requireTLS: false,
    auth: { user: "synthetic", pass: "synthetic-only" }, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  expect(smtpTransportOptions({ ...raw, port: 587, secure: false }).requireTLS).toBe(true);
});

it("rejects malformed delivery metadata before generating mail", async () => {
  await expect(prepareSmtpMessage({ deliveryId: "a8348fe2-4bc5-4c99-903a-317ac46c972a", to: "synthetic@example.invalid", subject: "Synthetic\r\nBcc: invalid", text: "Synthetic", html: "<p>Synthetic</p>" }, "sender@example.invalid")).rejects.toThrow();
});
