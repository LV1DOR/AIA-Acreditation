import { expect, it, vi } from "vitest";
const mail = vi.hoisted(() => ({ sendMail: vi.fn().mockResolvedValue({ accepted: ["synthetic@example.invalid"] }), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: mail.createTransport.mockReturnValue(mail) } }));
import { createSmtpTransport } from "../../packages/email/src/index.ts";
import { logoContentId } from "../../packages/email/src/layout.tsx";
import { logoBase64 } from "../../packages/email/src/logo.ts";

it("adds only an inline public PNG, preserves plaintext and retains SMTP security", async () => {
  const transport = createSmtpTransport({ host: "smtp.example.invalid", port: 2465, secure: true, from: "sender@example.invalid", user: "synthetic", password: "synthetic-only" });
  await transport.send({ deliveryId: "a8348fe2-4bc5-4c99-903a-317ac46c972a", to: "synthetic@example.invalid", subject: "Synthetic verification", text: "Unchanged code 123456", html: "<p>Unchanged code 123456</p>" });
  expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false }));
  const sent = mail.sendMail.mock.calls[0]![0];
  expect(sent.text).toBe("Unchanged code 123456");
  expect(sent.html).toContain(`cid:${logoContentId}`);
  expect(sent.html).toContain("123456");
  expect(sent.attachments).toHaveLength(1);
  expect(sent.attachments[0]).toMatchObject({ contentType: "image/png", contentDisposition: "inline", cid: logoContentId });
  expect(sent.attachments[0].content.equals(Buffer.from(logoBase64, "base64"))).toBe(true);
  expect(sent.messageId).toBe("<a8348fe2-4bc5-4c99-903a-317ac46c972a@example.invalid>");
  transport.close();
});
