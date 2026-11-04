import { z } from "zod";

// Persist only the explicitly selected metadata/diagnostic fields. These are
// displayed as escaped text, never as HTML, and are never application logs.
export function monitorEmailText(raw: unknown, limit = 8000): string | null {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) && raw.every(v => typeof v === "string") ? raw.join("\n") : "";
  // eslint-disable-next-line no-control-regex -- Explicitly remove non-printable provider input while retaining tabs/newlines.
  const clean = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\b(?:whsec_|re_)[A-Za-z0-9+/=_-]{12,}/g, "[credential redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token redacted]")
    .replace(/([?&](?:token|key|secret|signature|code|password|authorization)=)[^&\s<>]*/gi, "$1[redacted]")
    .trim();
  return clean ? clean.slice(0, limit) : null;
}
export const monitorEmailSubject = (raw: unknown) => monitorEmailText(raw, 998)?.replace(/\s+/g, " ") ?? null;
export function monitorSender(raw?: string | null) {
  const address = raw?.match(/<([^<>]+)>\s*$/)?.[1] ?? raw;
  const parsed = z.email().max(320).safeParse(address?.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}
export function shouldMonitorSender(raw: string | undefined | null, configured = process.env.RESEND_MONITOR_FROM_DOMAINS) {
  if (!configured?.trim()) return true;
  const domains = configured.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!domains.length || domains.some(d => !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d))) throw new Error("INVALID_MONITOR_SENDER_DOMAINS");
  const sender = monitorSender(raw);
  return Boolean(sender && domains.includes(sender.slice(sender.lastIndexOf("@") + 1)));
}
export function classifyEmailFailure(subtype?: string, message?: string | null, smtp?: string | null) {
  const text = `${message ?? ""}\n${smtp ?? ""}`;
  if (subtype === "NoEmail" || /\b5\.1\.1\b|NoSuchUser|recipient (?:not found|address .*doesn.t exist)|user unknown|mailbox .*does not exist/i.test(text)) return "RECIPIENT_NOT_FOUND";
  if (subtype === "MailboxFull" || /\b5\.2\.2\b|mailbox (?:is )?full|over quota/i.test(text)) return "MAILBOX_FULL";
  if (subtype === "MessageTooLarge" || /\b5\.3\.4\b|message (?:is )?too large/i.test(text)) return "MESSAGE_TOO_LARGE";
  return null;
}
