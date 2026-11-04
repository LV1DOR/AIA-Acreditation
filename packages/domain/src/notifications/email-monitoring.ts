import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@aia/database";
import { transaction, type Tx } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import type { ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";
import { monitorEmailText, monitorEmailSubject, monitorSender, shouldMonitorSender, classifyEmailFailure } from "./email-observability.ts";
import { emailSearchPatterns } from "./email-search.ts";

export const resendEventTypes = ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.failed", "email.suppressed", "email.complained"] as const;
export const emailStatuses = ["QUEUED", "RETRYING", "UNKNOWN", "EXPIRED", "SENT", "DELIVERY_DELAYED", "DELIVERED", "BOUNCED", "FAILED", "SUPPRESSED", "COMPLAINED"] as const;
export const emailMetadataHash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalEmail = (value: string) => z.email().max(320).parse(value.trim().toLowerCase());
const statusOf = (type: string) => type.replace(/^email\./, "").toUpperCase();
// A late sent/delay cannot undo an observed terminal outcome; a complaint or
// bounce remains visible even if delivery was previously reported. Arrival
// order never decides state. Equal-state timestamps are deterministic.
const priority: Record<string, number> = { SENT: 10, DELIVERY_DELAYED: 20, DELIVERED: 30, FAILED: 40, SUPPRESSED: 50, BOUNCED: 60, COMPLAINED: 70 };
export function observedEmailStatus(row: { status: string; providerStatus: string | null; reconciledStatus: string | null }) {
  const webhook = row.providerStatus, snapshot = row.reconciledStatus;
  return snapshot && (priority[snapshot] ?? 0) > (priority[webhook ?? ""] ?? 0) ? snapshot : webhook ?? snapshot ?? row.status;
}

const eventSchema = z.object({
  type: z.enum(resendEventTypes), created_at: z.iso.datetime({ offset: true }),
  data: z.object({
    email_id: z.uuid(), created_at: z.iso.datetime({ offset: true }).optional(),
    message_id: z.string().max(500).optional(), to: z.array(z.email().max(320)).min(1).max(100),
    from: z.string().max(500).optional(), subject: z.string().optional(),
    bounce: z.object({ type: z.string().max(100).optional(), subType: z.string().max(100).optional(), message: z.string().optional(), diagnosticCode: z.union([z.string(), z.array(z.string()).max(100)]).optional() }).optional(),
    failed: z.object({ reason: z.string().optional(), message: z.string().optional() }).optional(),
    suppressed: z.object({ type: z.string().max(100).optional(), message: z.string().optional() }).optional(),
    delivery_delayed: z.object({ message: z.string().optional(), diagnosticCode: z.union([z.string(), z.array(z.string()).max(100)]).optional() }).optional(),
  }),
});
export function parseResendEvent(raw: unknown) {
  const type = z.object({ type: z.string() }).parse(raw).type;
  return (resendEventTypes as readonly string[]).includes(type) ? eventSchema.parse(raw) : null;
}
type ResendEvent = z.infer<typeof eventSchema>;
function reasonCode(event: ResendEvent) {
  const smtp = monitorEmailText(event.data.bounce?.diagnosticCode ?? event.data.delivery_delayed?.diagnosticCode);
  const message = monitorEmailText(event.data.bounce?.message ?? event.data.failed?.message ?? event.data.suppressed?.message ?? event.data.delivery_delayed?.message);
  const classified = classifyEmailFailure(event.data.bounce?.subType, message, smtp);
  if (event.type === "email.bounced" && classified) return classified;
  const subtype = event.data.bounce?.subType;
  const known = ["General", "NoEmail", "Suppressed", "MailboxFull", "MessageTooLarge", "ContentRejected", "AttachmentRejected", "MessageRejected", "OnAccountSuppressionList"];
  if (event.type === "email.bounced" && subtype && known.includes(subtype)) return `BOUNCE_${subtype}`;
  if (event.type === "email.failed" && event.data.failed?.reason === "reached_daily_quota") return "DAILY_QUOTA_EXCEEDED";
  if (event.type === "email.suppressed" && event.data.suppressed?.type === "OnAccountSuppressionList") return "ACCOUNT_SUPPRESSION";
  return ["email.failed", "email.suppressed", "email.bounced", "email.delivery_delayed", "email.complained"].includes(event.type) ? statusOf(event.type) : null;
}

export async function emailQueueContext(tx: Tx, scope: { registrationId?: string; eventId?: string }) {
  const registration = scope.registrationId ? await tx.companyEventRegistration.findUnique({ where: { id: scope.registrationId }, select: { companyId: true, eventId: true } }) : null;
  return { companyId: registration?.companyId, eventId: registration?.eventId ?? scope.eventId };
}
export async function recordEmailRecipient(db: PrismaClient, outboxMessageId: string, recipient: string, category: string, subject?: string) {
  const address = normalEmail(recipient);
  await db.emailDelivery.updateMany({ where: { outboxMessageId, erasedAt: null }, data: { recipients: [address], recipientHash: emailMetadataHash(address), category, ...(subject ? { subject: monitorEmailSubject(subject) } : {}) } });
}

export async function findProviderEmail(tx: Tx, emailId: string, rfcMessageId?: string) {
  const idHash = emailMetadataHash(emailId), identity = await tx.emailProviderIdentity.findUnique({ where: { idHash }, include: { message: true } });
  if (identity) return identity.message;
  return tx.emailDelivery.findFirst({ where: { OR: [
    { resendIdHash: idHash }, { provider: "resend", providerMessageId: emailId },
    ...(rfcMessageId ? [{ rfcIdHash: emailMetadataHash(rfcMessageId) }, { providerMessageId: rfcMessageId }] : []),
  ] } });
}
export async function recordProviderIdentity(tx: Tx, emailDeliveryId: string, emailId: string, erased = false) {
  const idHash = emailMetadataHash(emailId);
  await tx.emailProviderIdentity.createMany({ data: [{ idHash, resendEmailId: erased ? null : emailId, emailDeliveryId }], skipDuplicates: true });
  const identity = await tx.emailProviderIdentity.findUniqueOrThrow({ where: { idHash } });
  if (identity.emailDeliveryId !== emailDeliveryId) throw new Error("RESEND_IDENTITY_CONFLICT");
  if (erased) await tx.emailProviderIdentity.update({ where: { idHash }, data: { resendEmailId: null, reconciledAt: null, reconciledStatus: null } });
}

async function projectEvents(tx: Tx, id: string) {
  const events = await tx.emailDeliveryEvent.findMany({ where: { emailDeliveryId: id }, select: { type: true, occurredAt: true }, orderBy: [{ occurredAt: "asc" }, { type: "asc" }] });
  let selected: typeof events[number] | undefined;
  for (const event of events) if (!selected || (priority[statusOf(event.type)] ?? 0) >= (priority[statusOf(selected.type)] ?? 0)) selected = event;
  const message = await tx.emailDelivery.findUniqueOrThrow({ where: { id }, select: { sentAt: true } });
  if (selected) await tx.emailDelivery.update({ where: { id }, data: {
    providerStatus: statusOf(selected.type), providerStatusAt: selected.occurredAt,
    deliveredAt: events.find(e => e.type === "email.delivered")?.occurredAt ?? null,
    sentAt: message.sentAt ?? events.find(e => e.type === "email.sent")?.occurredAt ?? null,
  } });
}

// Called inside the existing send-acknowledgement transaction. Do not overwrite
// webhook state with SENT. If the webhook won the race, attach its observations
// to the original queued row and retain that row's application context.
export async function recordEmailSent(tx: Tx, outboxMessageId: string, sent: { provider: "smtp" | "resend"; messageId: string; sender?: string }) {
  const current = await tx.emailDelivery.findUniqueOrThrow({ where: { outboxMessageId } });
  const direct = sent.provider === "resend" && z.uuid().safeParse(sent.messageId).success;
  const hash = emailMetadataHash(sent.messageId);
  if (current.erasedAt) {
    if (direct) await recordProviderIdentity(tx, current.id, sent.messageId, true);
    else await tx.emailDelivery.update({ where: { id: current.id }, data: { rfcIdHash: hash } });
    return;
  }
  const orphan = await tx.emailDelivery.findFirst({ where: { id: { not: current.id }, outboxMessageId: null, ...(direct ? { resendIdHash: hash } : { rfcIdHash: hash }) } });
  if (orphan) {
    await tx.emailDeliveryEvent.updateMany({ where: { emailDeliveryId: orphan.id }, data: { emailDeliveryId: current.id } });
    await tx.emailProviderIdentity.updateMany({ where: { emailDeliveryId: orphan.id }, data: { emailDeliveryId: current.id } });
    await tx.emailDelivery.delete({ where: { id: orphan.id } });
  }
  await tx.emailDelivery.update({ where: { id: current.id }, data: {
    provider: orphan?.provider ?? (current.resendEmailId ? "resend" : sent.provider),
    providerMessageId: sent.messageId,
    ...(sent.sender ? { sender: monitorSender(sent.sender), senderDomain: monitorSender(sent.sender)?.split("@")[1] } : {}),
    ...(direct ? { resendEmailId: current.resendEmailId ?? sent.messageId, resendIdHash: current.resendIdHash ?? hash } : { rfcMessageId: sent.messageId, rfcIdHash: hash }),
    ...(orphan ? { resendEmailId: current.resendEmailId ?? orphan.resendEmailId, resendIdHash: current.resendIdHash ?? orphan.resendIdHash, lastWebhookAt: orphan.lastWebhookAt, reconciledAt: orphan.reconciledAt, reconciledStatus: orphan.reconciledStatus, subject: current.subject ?? orphan.subject, sender: current.sender ?? orphan.sender, senderDomain: current.senderDomain ?? orphan.senderDomain } : {}),
    ...(orphan?.erasedAt ? { lastFailureCode: "RETENTION_EXPIRED", recipientHash: null, providerMessageId: null } : {}),
  } });
  if (direct) await recordProviderIdentity(tx, current.id, sent.messageId, Boolean(orphan?.erasedAt));
  if (orphan) await projectEvents(tx, current.id);
}

// Input has already passed SDK signature verification. A failed commit MUST
// propagate to the route (503), allowing Resend to retry. No deferred work.
export async function persistResendEvent(db: PrismaClient, event: ResendEvent, svixId: string, payloadDigest: string) {
  z.string().min(1).max(200).parse(svixId);
  // Scope is evaluated only after signature verification. An account-wide
  // webhook must not silently import other applications' sender domains.
  if (!shouldMonitorSender(event.data.from)) return "IGNORED_SENDER";
  return transaction(db, async tx => {
    const previous = await tx.emailDeliveryEvent.findUnique({ where: { svixId } });
    if (previous) {
      if (previous.payloadDigest !== payloadDigest) throw new Error("RESEND_EVENT_ID_COLLISION");
      return "DUPLICATE";
    }
    const idHash = emailMetadataHash(event.data.email_id), rfcHash = event.data.message_id ? emailMetadataHash(event.data.message_id) : undefined;
    let message = await findProviderEmail(tx, event.data.email_id, event.data.message_id);
    // A retention tombstone must never be rehydrated by a late webhook/replay.
    if (message?.erasedAt || message?.lastFailureCode === "RETENTION_EXPIRED" || message?.lastFailureCode === "PRIVACY_ERASURE") {
      await recordProviderIdentity(tx, message.id, event.data.email_id, true);
      return "ERASED";
    }
    const recipients = [...new Set([...(message?.recipients ?? []), ...event.data.to.map(normalEmail)])];
    const data = {
      provider: "resend", resendEmailId: message?.resendEmailId ?? event.data.email_id, resendIdHash: message?.resendIdHash ?? idHash,
      ...(rfcHash ? { rfcMessageId: event.data.message_id, rfcIdHash: rfcHash } : {}),
      recipients, recipientHash: recipients.length === 1 ? emailMetadataHash(recipients[0]!) : null,
      lastWebhookAt: new Date(),
      ...(event.data.subject !== undefined ? { subject: monitorEmailSubject(event.data.subject) } : {}),
      ...(event.data.from ? { sender: monitorSender(event.data.from), senderDomain: monitorSender(event.data.from)?.split("@")[1] } : {}),
    };
    if (message) message = await tx.emailDelivery.update({ where: { id: message.id }, data });
    else {
      // ON CONFLICT + serializable retry also handles concurrent first events.
      await tx.emailDelivery.createMany({ data: [{ ...data, status: "UNKNOWN", category: "UNLINKED_RESEND", createdAt: event.data.created_at ? new Date(event.data.created_at) : new Date(event.created_at) }], skipDuplicates: true });
      message = await tx.emailDelivery.findUniqueOrThrow({ where: { resendIdHash: idHash } });
    }
    await recordProviderIdentity(tx, message.id, event.data.email_id);
    const inserted = await tx.emailDeliveryEvent.createMany({ data: [{ emailDeliveryId: message.id, resendEmailId: event.data.email_id, svixId, payloadDigest, type: event.type, occurredAt: new Date(event.created_at), reasonCode: reasonCode(event),
      providerMessage: monitorEmailText(event.data.bounce?.message ?? event.data.failed?.message ?? event.data.failed?.reason ?? event.data.suppressed?.message ?? event.data.delivery_delayed?.message, 4000),
      smtpResponse: monitorEmailText(event.data.bounce?.diagnosticCode ?? event.data.delivery_delayed?.diagnosticCode),
    }], skipDuplicates: true });
    if (!inserted.count) {
      const duplicate = await tx.emailDeliveryEvent.findUniqueOrThrow({ where: { svixId } });
      if (duplicate.payloadDigest !== payloadDigest) throw new Error("RESEND_EVENT_ID_COLLISION");
    }
    await projectEvents(tx, message.id);
    await tx.operationalHeartbeat.upsert({ where: { id: "resend-webhook" }, create: { id: "resend-webhook", lastSeenAt: new Date() }, update: { lastSeenAt: new Date() } });
    return "STORED";
  });
}

const optionalFilter = <T extends z.ZodType>(schema: T) => z.preprocess(value => value === "" ? undefined : value, schema.optional());
export const emailMonitorQuery = z.object({
  q: z.string().trim().max(200).default(""), status: optionalFilter(z.enum(emailStatuses)),
  provider: optionalFilter(z.enum(["resend", "smtp", "unknown"])), eventId: optionalFilter(z.uuid()),
  cursor: optionalFilter(z.uuid()), direction: optionalFilter(z.enum(["older", "newer"])),
});
export type EmailMonitorQuery = Partial<z.output<typeof emailMonitorQuery>>;
const summarySelect = {
  id: true, outboxMessageId: true, recipients: true, category: true, companyId: true, eventId: true,
  subject: true, sender: true, senderDomain: true,
  provider: true, providerMessageId: true, resendEmailId: true, status: true, attempts: true, lastFailureCode: true,
  sentAt: true, createdAt: true, providerStatus: true, providerStatusAt: true, deliveredAt: true,
  lastWebhookAt: true, reconciledAt: true, reconciledStatus: true, erasedAt: true,
  providerIdentities: { where: { resendEmailId: { not: null } }, select: { resendEmailId: true, reconciledAt: true, reconciledStatus: true }, orderBy: { createdAt: "asc" }, take: 100 },
} satisfies Prisma.EmailDeliverySelect;

async function enrichMessages(db: PrismaClient, rows: Prisma.EmailDeliveryGetPayload<{ select: typeof summarySelect }>[]) {
  const [companies, events] = await Promise.all([
    db.company.findMany({ where: { id: { in: rows.flatMap(r => r.companyId ? [r.companyId] : []) } }, select: { id: true, name: true } }),
    db.event.findMany({ where: { id: { in: rows.flatMap(r => r.eventId ? [r.eventId] : []) } }, select: { id: true, name: true } }),
  ]);
  return rows.map(row => ({ ...row, displayStatus: observedEmailStatus(row), companyName: companies.find(c => c.id === row.companyId)?.name ?? null, eventName: events.find(e => e.id === row.eventId)?.name ?? null }));
}
export async function listMonitoredEmails(db: PrismaClient, context: ActorContext, raw: EmailMonitorQuery = {}) {
  requireAdmin(await resolveActor(db, context));
  const query = emailMonitorQuery.parse(raw), where: Prisma.EmailDeliveryWhereInput = { erasedAt: null };
  const newer = query.direction === "newer" && Boolean(query.cursor), pageSize = 15;
  if (query.eventId) where.eventId = query.eventId;
  if (query.provider) where.provider = query.provider === "unknown" ? null : query.provider;
  if (query.status) {
    // Match the displayed projection, including a higher-priority API snapshot.
    const selected = query.status, rank = priority[selected] ?? 0;
    const lower = Object.keys(priority).filter(s => priority[s]! < rank);
    where.AND = [{ OR: [
      { providerStatus: selected, OR: [{ reconciledStatus: null }, { reconciledStatus: { in: [...lower, selected] } }] },
      { reconciledStatus: selected, OR: [{ providerStatus: null }, { providerStatus: { in: lower } }] },
      { providerStatus: null, reconciledStatus: null, status: selected },
    ] }];
  }
  let position: { createdAt: Date; id: string } | null = null;
  if (query.cursor) {
    const cursor = await db.emailDelivery.findUnique({ where: { id: query.cursor }, select: { createdAt: true, id: true } });
    if (!cursor) throw new DomainError("NOT_FOUND");
    position = cursor;
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: [
      { createdAt: newer ? { gt: cursor.createdAt } : { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: newer ? { gt: cursor.id } : { lt: cursor.id } },
    ] }];
  }
  if (query.q) {
    // Search the complete filtered set in PostgreSQL, then fetch only one page
    // through Prisma. No truncated in-memory candidate set, extension or schema
    // change. All patterns and filters are bound parameters, never SQL strings.
    const rank = (column: Prisma.Sql) => Prisma.sql`CASE ${column} ${Prisma.join(Object.entries(priority).map(([status, value]) => Prisma.sql`WHEN ${status} THEN ${value}`), " ")} ELSE 0 END`;
    const status = Prisma.sql`CASE WHEN ${rank(Prisma.sql`m."reconciledStatus"`)} > ${rank(Prisma.sql`m."providerStatus"`)} THEN m."reconciledStatus" ELSE COALESCE(m."providerStatus", m."reconciledStatus", m.status) END`;
    const conditions = [Prisma.sql`m."erasedAt" IS NULL`];
    if (query.status) conditions.push(Prisma.sql`${status} = ${query.status}`);
    if (query.eventId) conditions.push(Prisma.sql`m."eventId" = ${query.eventId}::uuid`);
    if (query.provider) conditions.push(query.provider === "unknown" ? Prisma.sql`m.provider IS NULL` : Prisma.sql`m.provider = ${query.provider}`);
    if (position) conditions.push(newer ? Prisma.sql`(m."createdAt", m.id) > (${position.createdAt}, ${position.id}::uuid)` : Prisma.sql`(m."createdAt", m.id) < (${position.createdAt}, ${position.id}::uuid)`);
    const text = Prisma.sql`translate(lower(concat_ws(' ', array_to_string(m.recipients, ' '), m.subject, m.sender, m.category, m."providerMessageId", m."resendEmailId"::text, m.id::text, c.name, e.name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;
    const terms = emailSearchPatterns(query.q).map(pattern => Prisma.sql`(${text} ~* ${pattern} OR EXISTS (SELECT 1 FROM "EmailProviderIdentity" p WHERE p."emailDeliveryId" = m.id AND p."resendEmailId"::text ~* ${pattern}))`);
    conditions.push(Prisma.sql`((${Prisma.join(terms, " AND ")}) OR m."recipientHash" = ${emailMetadataHash(query.q.toLowerCase())})`);
    const ordering = newer ? Prisma.sql`m."createdAt" ASC, m.id ASC` : Prisma.sql`m."createdAt" DESC, m.id DESC`;
    const matches = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m.id FROM "EmailDelivery" m LEFT JOIN "Company" c ON c.id = m."companyId" LEFT JOIN "Event" e ON e.id = m."eventId" WHERE ${Prisma.join(conditions, " AND ")} ORDER BY ${ordering} LIMIT ${pageSize + 1}`);
    where.id = { in: matches.map(row => row.id) };
  }
  const order = newer ? "asc" : "desc";
  const rows = await db.emailDelivery.findMany({ where, select: summarySelect, orderBy: [{ createdAt: order }, { id: order }], take: pageSize + 1 });
  const page = rows.slice(0, pageSize);
  if (newer) page.reverse();
  return {
    messages: await enrichMessages(db, page),
    nextCursor: (newer ? Boolean(query.cursor) : rows.length > pageSize) ? page.at(-1)?.id ?? null : null,
    previousCursor: (newer ? rows.length > pageSize : Boolean(query.cursor)) ? page[0]?.id ?? null : null,
  };
}
export async function monitoredEmailDetail(db: PrismaClient, context: ActorContext, id: string, cursor?: string) {
  requireAdmin(await resolveActor(db, context));
  z.uuid().parse(id); if (cursor) z.uuid().parse(cursor);
  const message = await db.emailDelivery.findFirst({ where: { id, erasedAt: null }, select: summarySelect });
  if (!message) throw new DomainError("NOT_FOUND");
  const position = cursor ? await db.emailDeliveryEvent.findFirst({ where: { id: cursor, emailDeliveryId: id }, select: { occurredAt: true, id: true } }) : null;
  if (cursor && !position) throw new DomainError("NOT_FOUND");
  const history = await db.emailDeliveryEvent.findMany({ where: { emailDeliveryId: id, ...(position ? { OR: [
    { occurredAt: { lt: position.occurredAt } }, { occurredAt: position.occurredAt, id: { lt: position.id } },
  ] } : {}) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 51,
  select: { id: true, resendEmailId: true, svixId: true, type: true, occurredAt: true, receivedAt: true, reasonCode: true, providerMessage: true, smtpResponse: true } });
  return { message: (await enrichMessages(db, [message]))[0]!, events: history.slice(0, 50), nextCursor: history.length > 50 ? history[49]!.id : null };
}
export async function emailMonitoringHealth(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  const [webhook, reconciliation, unconfirmed] = await Promise.all([
    db.operationalHeartbeat.findUnique({ where: { id: "resend-webhook" }, select: { lastSeenAt: true } }),
    db.operationalHeartbeat.findUnique({ where: { id: "resend-reconciliation" }, select: { lastSeenAt: true, lastErrorCode: true } }),
    db.emailDelivery.count({ where: { erasedAt: null, provider: "resend", lastWebhookAt: null, sentAt: { lt: new Date(Date.now() - 15 * 60000) } } }),
  ]);
  return { lastWebhookAt: webhook?.lastSeenAt ?? null, lastReconciliationAt: reconciliation?.lastSeenAt ?? null, reconciliationFailed: Boolean(reconciliation?.lastErrorCode), unconfirmed };
}
