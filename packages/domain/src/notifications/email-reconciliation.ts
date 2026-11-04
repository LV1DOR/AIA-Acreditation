import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { transaction } from "../shared/transaction.ts";
import { emailMetadataHash, findProviderEmail, recordProviderIdentity, observedEmailStatus } from "./email-monitoring.ts";
import { monitorEmailSubject, monitorSender, shouldMonitorSender } from "./email-observability.ts";

export type ResendMetadataPage = { hasMore: boolean; messages: { id: string; messageId?: string | null; to: string[]; createdAt: string; status: string; from?: string; subject?: string }[] };
const snapshot = z.object({ id: z.uuid(), messageId: z.string().min(1).max(500).nullish(), to: z.array(z.email().max(320)).max(100), createdAt: z.string().max(100), status: z.string().max(40), from: z.string().max(500).optional(), subject: z.string().optional() });
const supported = ["sent", "delivered", "delivery_delayed", "bounced", "failed", "suppressed", "complained"];

// Operator-only metadata reconciliation. Never send, replay, fetch bodies, or
// import another application's messages just because they share a Resend team.
// Snapshot observation time is NOT a delivery timestamp or a webhook event.
export async function reconcileRecentResendMessages(db: PrismaClient, read: (after?: string) => Promise<ResendMetadataPage>, since: Date, maxPages = 5) {
  if (!Number.isFinite(since.getTime()) || since > new Date() || maxPages < 1 || maxPages > 20 || !Number.isInteger(maxPages)) throw new Error("INVALID_RECONCILIATION_WINDOW");
  let after: string | undefined, matched = 0, pages = 0, truncated = false;
  try {
    for (; pages < maxPages;) {
      const page = await read(after); pages++;
      for (const raw of page.messages) {
        const item = snapshot.parse(raw), sentAt = new Date(item.createdAt);
        if (!Number.isFinite(sentAt.getTime())) throw new Error("INVALID_PROVIDER_TIMESTAMP");
        if (sentAt < since || !supported.includes(item.status) || !shouldMonitorSender(item.from)) continue;
        const changed = await transaction(db, async tx => {
          const idHash = emailMetadataHash(item.id);
          const row = await findProviderEmail(tx, item.id, item.messageId ?? undefined);
          if (!row) return false;
          if (row.erasedAt || row.lastFailureCode === "RETENTION_EXPIRED" || row.lastFailureCode === "PRIVACY_ERASURE") {
            await recordProviderIdentity(tx, row.id, item.id, true); return false;
          }
          await recordProviderIdentity(tx, row.id, item.id);
          await tx.emailProviderIdentity.update({ where: { idHash }, data: { reconciledAt: new Date(), reconciledStatus: item.status.toUpperCase() } });
          await tx.emailDelivery.update({ where: { id: row.id }, data: {
            provider: "resend", resendEmailId: row.resendEmailId ?? item.id, resendIdHash: row.resendIdHash ?? idHash,
            ...(item.messageId ? { rfcMessageId: item.messageId, rfcIdHash: emailMetadataHash(item.messageId) } : {}),
            ...(item.subject !== undefined ? { subject: monitorEmailSubject(item.subject) } : {}),
            ...(item.from ? { sender: monitorSender(item.from), senderDomain: monitorSender(item.from)?.split("@")[1] } : {}),
            recipients: [...new Set([...row.recipients, ...item.to.map(a => a.trim().toLowerCase())])], reconciledAt: new Date(),
            reconciledStatus: observedEmailStatus({ status: row.status, providerStatus: row.reconciledStatus, reconciledStatus: item.status.toUpperCase() }),
          } });
          return true;
        });
        if (changed) matched++;
      }
      if (!page.hasMore || page.messages.length === 0) { truncated = false; break; }
      after = page.messages.at(-1)!.id;
      truncated = true;
    }
    await db.operationalHeartbeat.upsert({ where: { id: "resend-reconciliation" }, create: { id: "resend-reconciliation", lastSeenAt: new Date() }, update: { lastSeenAt: new Date(), lastErrorCode: null } });
    return { matched, pages, truncated };
  } catch {
    await db.operationalHeartbeat.upsert({ where: { id: "resend-reconciliation" }, create: { id: "resend-reconciliation", lastSeenAt: new Date(), lastErrorCode: "RESEND_RECONCILIATION_FAILED" }, update: { lastSeenAt: new Date(), lastErrorCode: "RESEND_RECONCILIATION_FAILED" } }).catch(() => undefined);
    throw new Error("RESEND_RECONCILIATION_FAILED");
  }
}
