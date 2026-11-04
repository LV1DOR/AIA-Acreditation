import nodemailer from "nodemailer";
import { z } from "zod";
import { brandEmailHtml, logoContentId } from "./layout.tsx";
import { logoBase64 } from "./logo.ts";

const messageSchema = z.object({
  deliveryId: z.uuid(),
  to: z.email(),
  subject: z.string().min(1).max(200).refine(v => !/[\r\n]/.test(v)),
  text: z.string().min(1),
  html: z.string().min(1),
}).strict();
export type EmailMessage = z.infer<typeof messageSchema>;
export { encryptEmail, decryptEmail } from "./encryption.ts";
export { businessEmailTemplate, businessEmailData, renderBusinessEmail } from "./templates.tsx";
export type { BusinessEmailTemplate, BusinessEmailData } from "./templates.tsx";
export { renderInvitationEmail } from "./invitation.tsx";
export interface EmailTransport {
  send(message: EmailMessage): Promise<{ provider: "smtp" | "resend"; messageId: string; sender?: string }>;
  close(): void;
}
const smtpSchema = z.object({
  host: z.string().min(1), port: z.number().int().positive().max(65535),
  secure: z.boolean(), from: z.email(),
  user: z.string().min(1).optional(), password: z.string().min(1).optional(),
}).strict().refine(v => Boolean(v.user) === Boolean(v.password));
export function smtpTransportOptions(raw: z.input<typeof smtpSchema>) {
  const options = smtpSchema.parse(raw);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(options.host);
  return {
    host: options.host, port: options.port, secure: options.secure,
    requireTLS: !loopback && !options.secure,
    auth: options.user ? { user: options.user, pass: options.password } : undefined,
    logger: false, debug: false,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

/** Shared by SMTP delivery and offline MIME/JSON transport verification. */
export async function prepareSmtpMessage(rawMessage: EmailMessage, rawFrom: string) {
  const message = messageSchema.parse(rawMessage), from = z.email().parse(rawFrom);
  const domain = from.split("@")[1];
  return {
    from, to: message.to, subject: message.subject,
    text: message.text, html: await brandEmailHtml(message.html, message.subject),
    messageId: "<" + message.deliveryId + "@" + domain + ">",
    attachments: [{ filename: "aia-logo.png", content: Buffer.from(logoBase64, "base64"),
      contentType: "image/png", contentDisposition: "inline" as const, cid: logoContentId }],
  };
}

export function createSmtpTransport(raw: z.input<typeof smtpSchema>): EmailTransport {
  const options = smtpSchema.parse(raw);
  const transport = nodemailer.createTransport(smtpTransportOptions(options));
  return {
    async send(rawMessage) {
      const message = messageSchema.parse(rawMessage);
      try {
        const prepared = await prepareSmtpMessage(message, options.from);
        const result = await transport.sendMail(prepared);
        if (!result.accepted?.length) throw new Error("EMAIL_DELIVERY_FAILED");
        // This identifies the already-configured SMTP service; it never selects
        // a provider or changes delivery. The RFC ID is NOT a Resend email UUID.
        // Webhooks or metadata reconciliation supply that UUID asynchronously.
        return { provider: options.host.toLowerCase() === "smtp.resend.com" ? "resend" : "smtp", messageId: prepared.messageId, sender: options.from };
      } catch {
        // Provider errors can contain recipients, credentials or message content.
        throw new Error("EMAIL_DELIVERY_FAILED");
      }
    },
    close() { transport.close(); },
  };
}
