import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { emailMetadataHash, listMonitoredEmails, monitoredEmailDetail, recordEmailSent, resendEventTypes } from "../../packages/domain/src/notifications/email-monitoring.ts";
import { reconcileRecentResendMessages } from "../../packages/domain/src/notifications/email-reconciliation.ts";
import { transaction } from "../../packages/domain/src/shared/transaction.ts";
import { cleanupExpiredCommunicationMetadata } from "../../packages/domain/src/privacy/communication-cleanup.ts";

const auth = vi.hoisted(() => ({ access: {} as Record<string, unknown> }));
vi.mock("../../apps/web/src/server/session.ts", () => ({ session: async () => auth.access }));
vi.mock("../../apps/web/src/server/runtime.ts", () => ({ database: () => db }));
import { POST } from "../../apps/web/src/app/api/webhooks/resend/route.ts";
import { GET as listGet } from "../../apps/web/src/app/api/admin/emails/route.ts";
import { GET as detailGet } from "../../apps/web/src/app/api/admin/emails/[id]/route.ts";

const secret = "whsec_" + randomBytes(32).toString("base64"), previousSecret = process.env.RESEND_WEBHOOK_SECRET, previousDomains = process.env.RESEND_MONITOR_FROM_DOMAINS;
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { process.env.RESEND_WEBHOOK_SECRET = secret; delete process.env.RESEND_MONITOR_FROM_DOMAINS; f = await fixture(db); });
beforeEach(() => { auth.access = { status: "GRANTED", role: "ADMIN", context: f.adminActor }; });
afterAll(async () => {
  if (previousSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = previousSecret;
  if (previousDomains === undefined) delete process.env.RESEND_MONITOR_FROM_DOMAINS; else process.env.RESEND_MONITOR_FROM_DOMAINS = previousDomains;
  await db.$disconnect();
});
function payload(type = "email.sent", emailId = randomUUID(), time = "2026-11-04T10:00:00.000Z", rfcId?: string) {
  return JSON.stringify({ type, created_at: time, data: { email_id: emailId, created_at: "2026-11-04T09:00:00.000Z", from: "synthetic@example.invalid", to: ["synthetic-recipient@example.invalid"], message_id: rfcId, subject: "SENSITIVE_SUBJECT_OTP", html: "SECRET_BODY", bounce: { subType: "NoEmail", message: "PRIVATE_SMTP_DIAGNOSTIC" } } }, null, 2);
}
function request(body: string, options: { id?: string; time?: Date; signingSecret?: string; alter?: boolean } = {}) {
  const id = options.id ?? "msg_" + randomUUID(), time = options.time ?? new Date();
  return new Request("http://localhost:3100/api/webhooks/resend", { method: "POST", body: options.alter ? body + " " : body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(Math.floor(time.getTime() / 1000)), "svix-signature": new Webhook(options.signingSecret ?? secret).sign(id, time, body) },
  });
}
const detailRequest = (id: string) => detailGet(new Request(`http://localhost/api/admin/emails/${id}`), { params: Promise.resolve({ id }) });

it("verifies the original raw body with the Resend SDK and rejects missing, forged, altered and stale signatures", async () => {
  const id = randomUUID(), body = payload("email.sent", id);
  expect((await POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", body }))).status).toBe(400);
  expect((await POST(request(body, { signingSecret: "whsec_" + randomBytes(32).toString("base64") }))).status).toBe(400);
  expect((await POST(request(body, { alter: true }))).status).toBe(400);
  expect((await POST(request(body, { time: new Date(Date.now() - 600_000) }))).status).toBe(400);
  expect(await db.emailDelivery.count({ where: { resendEmailId: id } })).toBe(0);
  // Pretty-printed JSON verifies without parsing and reserialising its bytes.
  expect((await POST(request(body))).status).toBe(204);
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
  expect(row.recipients).toEqual(["synthetic-recipient@example.invalid"]);
  expect(row.providerStatus).toBe("SENT");
  const events = await db.emailDeliveryEvent.findMany({ where: { emailDeliveryId: row.id } });
  expect(row.subject).toBe("SENSITIVE_SUBJECT_OTP");
  expect(JSON.stringify([row, events])).not.toContain("SECRET_BODY");
  expect(events[0]?.providerMessage).toBe("PRIVATE_SMTP_DIAGNOSTIC");
});

it("fails closed without configuration, bounds declared/streamed sizes, and ignores signed unrequested event types", async () => {
  delete process.env.RESEND_WEBHOOK_SECRET;
  expect((await POST(request(payload()))).status).toBe(503);
  process.env.RESEND_WEBHOOK_SECRET = secret;
  expect((await POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", headers: { "content-length": "1000001" }, body: "x" }))).status).toBe(413);
  expect((await POST(new Request("http://localhost/api/webhooks/resend", { method: "POST", body: "x".repeat(1_000_001) }))).status).toBe(413);
  const id = randomUUID();
  expect((await POST(request(payload("email.opened", id)))).status).toBe(204);
  expect(await db.emailDelivery.count({ where: { resendEmailId: id } })).toBe(0);
  expect((await POST(request('{"type":"email.sent","data":{}}'))).status).toBe(400);
});

it("deduplicates repeated and concurrent deliveries and refuses a reused event ID with a different payload", async () => {
  const id = randomUUID(), body = payload("email.sent", id), receipt = "msg_" + randomUUID();
  const responses = await Promise.all([POST(request(body, { id: receipt })), POST(request(body, { id: receipt }))]);
  expect(responses.map(r => r.status)).toEqual([204, 204]);
  expect((await POST(request(body, { id: receipt }))).status).toBe(204);
  expect(await db.emailDeliveryEvent.count({ where: { svixId: receipt } })).toBe(1);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect((await POST(request(payload("email.failed", id), { id: receipt }))).status).toBe(503); }
  finally { log.mockRestore(); }
});

it("stores all seven subscribed event types and projects deterministic terminal outcomes despite out-of-order arrivals", async () => {
  const id = randomUUID();
  const times: Record<string, string> = { "email.sent": "09:00", "email.delivery_delayed": "09:05", "email.delivered": "09:10", "email.failed": "09:11", "email.suppressed": "09:12", "email.bounced": "09:13", "email.complained": "09:14" };
  for (const type of [...resendEventTypes].reverse()) expect((await POST(request(payload(type, id, `2026-11-04T${times[type]}:00.000Z`)))).status).toBe(204);
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
  expect(row.providerStatus).toBe("COMPLAINED"); expect(row.status).toBe("UNKNOWN");
  expect(row.deliveredAt?.toISOString()).toBe("2026-11-04T09:10:00.000Z");
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(7);
  const timeline = await monitoredEmailDetail(db, f.adminActor, row.id);
  expect(timeline.events[0]?.type).toBe("email.complained");
  expect(timeline.events.find(e => e.type === "email.bounced")?.reasonCode).toBe("RECIPIENT_NOT_FOUND");
});

it("retains subject and SMTP diagnostics for the exact configured sender domain and classifies Gmail 5.1.1", async () => {
  const id = randomUUID(), other = randomUUID();
  process.env.RESEND_MONITOR_FROM_DOMAINS = "notify.joinaia.pt";
  const smtp = "smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please double-check the recipient's email address. https://support.google.com/mail/?p=NoSuchUser";
  const event = { type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: id, from: "AIA <notificacoes@notify.joinaia.pt>", to: ["synthetic-missing@example.invalid"], subject: "Convite AIA — Synthetic company", bounce: { subType: "General", message: "The recipient address does not exist.", diagnosticCode: [smtp] }, html: "PRIVATE_BODY_MUST_NOT_BE_STORED" } };
  try {
    expect((await POST(request(JSON.stringify(event)))).status).toBe(204);
    expect((await POST(request(JSON.stringify({ ...event, data: { ...event.data, email_id: other, from: "notify.joinaia.pt <sender@other.invalid>" } })))).status).toBe(204);
    expect(await db.emailDelivery.count({ where: { resendEmailId: other } })).toBe(0);
    const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
    expect(row).toMatchObject({ subject: event.data.subject, sender: "notificacoes@notify.joinaia.pt", senderDomain: "notify.joinaia.pt", providerStatus: "BOUNCED" });
    const detail = await monitoredEmailDetail(db, f.adminActor, row.id);
    expect(detail.events[0]).toMatchObject({ reasonCode: "RECIPIENT_NOT_FOUND", smtpResponse: smtp });
    expect(JSON.stringify(detail)).not.toContain("PRIVATE_BODY_MUST_NOT_BE_STORED");
    expect((await listMonitoredEmails(db, f.adminActor, { q: "Convite AIA — Synthetic company" })).messages.some(m => m.id === row.id)).toBe(true);
    await db.emailDelivery.update({ where: { id: row.id }, data: { recipientHash: null, providerMessageId: null, lastFailureCode: "RETENTION_EXPIRED" } });
    expect(await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ subject: null, sender: null, senderDomain: null });
    expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(0);
  } finally { delete process.env.RESEND_MONITOR_FROM_DOMAINS; }
});

it("serializes concurrent first events for one message without losing delivery evidence", async () => {
  const id = randomUUID();
  const responses = await Promise.all([
    POST(request(payload("email.delivered", id))),
    POST(request(payload("email.delivery_delayed", id, "2026-11-04T09:59:00.000Z"))),
    POST(request(payload("email.sent", id, "2026-11-04T09:58:00.000Z"))),
  ]);
  expect(responses.map(r => r.status)).toEqual([204, 204, 204]);
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
  expect(row.providerStatus).toBe("DELIVERED");
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(3);
});

it("does not acknowledge a database commit failure and leaves no partially persisted message or event", async () => {
  const id = randomUUID(), receipt = "msg_synthetic_commit_failure_" + randomUUID(), body = payload("email.delivered", id);
  // Real PostgreSQL deferred trigger: the INSERT succeeds and COMMIT fails.
  // This verifies that 2xx is sent only after durable transaction completion.
  await db.$executeRawUnsafe(`CREATE FUNCTION synthetic_resend_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."svixId"='${receipt}' THEN RAISE EXCEPTION 'synthetic commit failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_resend_commit_failure AFTER INSERT ON "EmailDeliveryEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_resend_commit_failure()`);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await POST(request(body, { id: receipt }))).status).toBe(503);
    expect(await db.emailDelivery.count({ where: { resendEmailId: id } })).toBe(0);
    expect(await db.emailDeliveryEvent.count({ where: { svixId: receipt } })).toBe(0);
    expect(await db.emailProviderIdentity.count({ where: { idHash: emailMetadataHash(id) } })).toBe(0);
  } finally {
    log.mockRestore();
    await db.$executeRawUnsafe('DROP TRIGGER synthetic_resend_commit_failure ON "EmailDeliveryEvent"');
    await db.$executeRawUnsafe("DROP FUNCTION synthetic_resend_commit_failure()");
  }
  expect((await POST(request(body, { id: receipt }))).status).toBe(204);
});

it("correlates SMTP RFC IDs and preserves events when a webhook precedes send acknowledgement", async () => {
  const outbox = await db.outboxMessage.create({ data: { type: "BUSINESS_EMAIL", deduplicationKey: randomUUID(), payload: {}, registrationId: f.registration.id, eventId: f.event.id } });
  const queue = await db.emailDelivery.create({ data: { outboxMessageId: outbox.id, category: "STATUS_UPDATE", companyId: f.company.id, eventId: f.event.id } });
  const id = randomUUID(), rfc = `<${outbox.id}@synthetic.example.invalid>`;
  expect((await POST(request(payload("email.delivered", id, "2026-11-04T10:00:00.000Z", rfc)))).status).toBe(204);
  await transaction(db, async tx => {
    await tx.emailDelivery.update({ where: { id: queue.id }, data: { status: "SENT", provider: "smtp", providerMessageId: rfc, sentAt: new Date() } });
    await recordEmailSent(tx, outbox.id, { provider: "smtp", messageId: rfc });
  });
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { id: queue.id } });
  expect(row).toMatchObject({ resendEmailId: id, provider: "resend", providerStatus: "DELIVERED", category: "STATUS_UPDATE", companyId: f.company.id });
  expect(await db.emailDelivery.count({ where: { resendEmailId: id } })).toBe(1);
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: queue.id } })).toBe(1);
  expect((await POST(request(payload("email.sent", id, "2026-11-04T09:00:00.000Z", rfc)))).status).toBe(204);
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: queue.id } })).providerStatus).toBe("DELIVERED");
});

it("preserves all provider identities across SMTP retries, searches and erasure without needing a repeated RFC ID", async () => {
  const first = randomUUID(), second = randomUUID(), rfc = `<${randomUUID()}@example.invalid>`;
  const row = await db.emailDelivery.create({ data: { provider: "resend", providerMessageId: rfc, status: "SENT", recipients: ["synthetic-recipient@example.invalid"] } });
  expect((await POST(request(payload("email.sent", first, "2026-11-04T09:00:00.000Z", rfc)))).status).toBe(204);
  expect((await POST(request(payload("email.sent", second, "2026-11-04T09:01:00.000Z", rfc)))).status).toBe(204);
  expect((await POST(request(payload("email.bounced", first)))).status).toBe(204);
  for (const id of [first, second]) {
    expect((await listMonitoredEmails(db, f.adminActor, { q: id })).messages.map(m => m.id)).toEqual([row.id]);
    expect((await db.emailProviderIdentity.findUniqueOrThrow({ where: { resendEmailId: id } })).emailDeliveryId).toBe(row.id);
  }
  const detail = await monitoredEmailDetail(db, f.adminActor, row.id);
  expect(detail.events.find(e => e.type === "email.bounced")?.resendEmailId).toBe(first);
  expect(detail.message.providerIdentities).toHaveLength(2);
  await db.emailDelivery.update({ where: { id: row.id }, data: { recipientHash: null, providerMessageId: null, lastFailureCode: "RETENTION_EXPIRED" } });
  for (const id of [first, second]) {
    expect((await POST(request(payload("email.delivered", id)))).status).toBe(204);
    expect(await db.emailDelivery.count({ where: { resendEmailId: id } })).toBe(0);
    const identity = await db.emailProviderIdentity.findUniqueOrThrow({ where: { idHash: emailMetadataHash(id) } });
    expect(identity).toMatchObject({ emailDeliveryId: row.id, resendEmailId: null });
    expect((await listMonitoredEmails(db, f.adminActor, { q: id })).messages).toHaveLength(0);
  }
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).recipients).toEqual([]);
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(0);
  const lateIdentity = randomUUID();
  expect((await POST(request(payload("email.sent", lateIdentity, "2026-11-04T09:02:00.000Z", rfc)))).status).toBe(204);
  expect((await POST(request(payload("email.delivered", lateIdentity)))).status).toBe(204);
  expect((await db.emailProviderIdentity.findUniqueOrThrow({ where: { idHash: emailMetadataHash(lateIdentity) } })).resendEmailId).toBeNull();
});

it("supports recipient fragments, fuzzy typos and context/status search across stable pages", async () => {
  const stamp = new Date(), recipients = [`pagination-${randomUUID()}@example.invalid`];
  await db.emailDelivery.createMany({ data: Array.from({ length: 31 }, () => ({ recipients, provider: "smtp", category: "BUSINESS_EMAIL", companyId: f.company.id, eventId: f.event.id, status: "SENT", createdAt: stamp })) });
  const first = await listMonitoredEmails(db, f.adminActor, { q: recipients[0], status: "SENT", provider: "smtp" });
  expect(first.messages).toHaveLength(15); expect(first.nextCursor).toBeTruthy(); expect(first.previousCursor).toBeNull();
  const fragment = recipients[0]!.split("@")[0]!;
  expect((await listMonitoredEmails(db, f.adminActor, { q: fragment.toUpperCase(), status: "SENT" })).messages).toHaveLength(15);
  const next = await listMonitoredEmails(db, f.adminActor, { q: recipients[0], cursor: first.nextCursor! });
  expect(next.messages).toHaveLength(15); expect(next.messages.some(r => first.messages.some(p => p.id === r.id))).toBe(false);
  const last = await listMonitoredEmails(db, f.adminActor, { q: recipients[0], cursor: next.nextCursor! });
  expect(last.messages).toHaveLength(1); expect(last.nextCursor).toBeNull();
  const previous = await listMonitoredEmails(db, f.adminActor, { q: recipients[0], cursor: last.previousCursor!, direction: "newer" });
  expect(previous.messages.map(row => row.id)).toEqual(next.messages.map(row => row.id));
  const newest = await listMonitoredEmails(db, f.adminActor, { q: recipients[0], cursor: previous.previousCursor!, direction: "newer" });
  expect(newest.messages.map(row => row.id)).toEqual(first.messages.map(row => row.id)); expect(newest.previousCursor).toBeNull();
  const all = await listMonitoredEmails(db, f.adminActor);
  expect(all.messages).toHaveLength(15);
  const allOlder = await listMonitoredEmails(db, f.adminActor, { cursor: all.nextCursor! });
  const allNewer = await listMonitoredEmails(db, f.adminActor, { cursor: allOlder.previousCursor!, direction: "newer" });
  expect(allNewer.messages.map(row => row.id)).toEqual(all.messages.map(row => row.id));
  expect(first.messages[0]?.companyName).toBe(f.company.name);
  expect((await listMonitoredEmails(db, f.adminActor, { q: f.company.name })).messages.length).toBeGreaterThan(0);
  const response = await listGet(new Request(`http://localhost/api/admin/emails?q=${recipients[0]}&provider=&status=`));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  const message = first.messages[0]!;
  await db.emailDeliveryEvent.createMany({ data: Array.from({ length: 52 }, () => ({ emailDeliveryId: message.id, svixId: "msg_" + randomUUID(), payloadDigest: "a".repeat(64), type: "email.sent", occurredAt: stamp })) });
  const detail = await monitoredEmailDetail(db, f.adminActor, message.id);
  expect(detail.events).toHaveLength(50); expect(detail.nextCursor).toBeTruthy();
  expect((await monitoredEmailDetail(db, f.adminActor, message.id, detail.nextCursor!)).events).toHaveLength(2);
});

it("matches fuzzy recipient and subject tokens, accents, literal punctuation, and excludes erased/filtered rows", async () => {
  const legacy = await db.emailDelivery.create({ data: { recipientHash: emailMetadataHash("legacy-search@example.invalid") } });
  expect((await listMonitoredEmails(db, f.adminActor, { q: "legacy-search@example.invalid" })).messages.map(item => item.id)).toContain(legacy.id);
  const row = await db.emailDelivery.create({ data: { recipients: ["lukevidor+fuzzy@example.invalid"], subject: "Convite Acreditação Needle[Literal]", provider: "resend", providerStatus: "DELIVERED", companyId: f.company.id, eventId: f.event.id } });
  for (const q of ["lukevidor", "LUKEVIDOR", "lukevidro", "lukevidr", "lukevxidor", "lukevydor", "acreditacao", "lukevidor convite"]) {
    expect((await listMonitoredEmails(db, f.adminActor, { q, status: "DELIVERED" })).messages.map(item => item.id), q).toContain(row.id);
  }
  expect((await listMonitoredEmails(db, f.adminActor, { q: "lukevidor", status: "BOUNCED" })).messages.map(item => item.id)).not.toContain(row.id);
  expect((await listMonitoredEmails(db, f.adminActor, { q: "Needle[Literal]" })).messages.map(item => item.id)).toContain(row.id);
  expect((await listMonitoredEmails(db, f.adminActor, { q: ".*" })).messages.map(item => item.id)).not.toContain(row.id);
  expect((await listMonitoredEmails(db, f.adminActor, { q: "' OR 1=1 --" })).messages).toHaveLength(0);
  await db.emailDelivery.update({ where: { id: row.id }, data: { erasedAt: new Date() } });
  expect((await listMonitoredEmails(db, f.adminActor, { q: "lukevidro" })).messages.map(item => item.id)).not.toContain(row.id);
});

it("requires an enabled database ADMIN for every read, even when a session claims ADMIN", async () => {
  const row = await db.emailDelivery.create({ data: { recipients: ["private@example.invalid"] } });
  for (const access of [ { status: "SIGNED_OUT" }, { status: "NO_ACCESS" }, { status: "GRANTED", role: "COMPANY_LEADER", context: f.leaderActor } ]) {
    auth.access = access;
    expect((await listGet(new Request("http://localhost/api/admin/emails"))).status).toBe(403);
    expect((await detailRequest(row.id)).status).toBe(403);
  }
  auth.access = { status: "GRANTED", role: "ADMIN", context: f.leaderActor };
  expect((await detailRequest(row.id)).status).toBe(403);
  await expect(listMonitoredEmails(db, f.leaderActor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const disabled = await db.user.create({ data: { clerkUserId: "disabled-" + randomUUID(), role: "ADMIN", disabledAt: new Date() } });
  auth.access = { status: "GRANTED", role: "ADMIN", context: { clerkUserId: disabled.clerkUserId, correlationId: randomUUID() } };
  expect((await detailRequest(row.id)).status).toBe(403);
  auth.access = { status: "GRANTED", role: "ADMIN", context: f.adminActor };
  const response = await detailRequest(row.id); expect(response.status).toBe(200);
  const text = await response.text(); expect(text).toContain("private@example.invalid");
  expect(text).not.toMatch(/payload|recipientHash|resendIdHash|encryption|signing|SECRET|html/);
});

it("redacts new metadata at existing retention boundaries and never restores it from a late replay", async () => {
  const id = randomUUID(), body = payload("email.bounced", id);
  expect((await POST(request(body))).status).toBe(204);
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
  await db.emailDelivery.update({ where: { id: row.id }, data: { recipientHash: null, providerMessageId: null, lastFailureCode: "RETENTION_EXPIRED" } });
  const erased = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
  expect(erased.recipients).toEqual([]); expect(erased.resendEmailId).toBeNull(); expect(erased.erasedAt).toBeTruthy();
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(0);
  expect((await POST(request(body))).status).toBe(204);
  expect(await db.emailDelivery.count({ where: { resendIdHash: emailMetadataHash(id) } })).toBe(1);
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).recipients).toEqual([]);
  await expect(monitoredEmailDetail(db, f.adminActor, row.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("redacts standalone monitoring metadata only with an approved cutoff and retains replay tombstones", async () => {
  const id = randomUUID(), body = payload("email.sent", id);
  expect((await POST(request(body))).status).toBe(204);
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { resendEmailId: id } });
  const previousCutoff = process.env.EMAIL_MONITOR_ERASE_BEFORE, previousReference = process.env.EMAIL_MONITOR_POLICY_REFERENCE;
  await db.emailDelivery.update({ where: { id: row.id }, data: { createdAt: new Date("1999-01-01T00:00:00.000Z") } });
  // Other integration files intentionally retain active synthetic holds. Isolate
  // this global-cutoff scenario, restoring all holds before the next file runs.
  const holds = await db.eventPrivacyHold.findMany({ where: { active: true }, select: { eventId: true } });
  await db.eventPrivacyHold.updateMany({ where: { eventId: { in: holds.map(h => h.eventId) } }, data: { active: false } });
  try {
    process.env.EMAIL_MONITOR_ERASE_BEFORE = new Date(Date.now() + 3600000).toISOString();
    process.env.EMAIL_MONITOR_POLICY_REFERENCE = "synthetic-policy";
    await cleanupExpiredCommunicationMetadata(db);
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).erasedAt).toBeNull();
    process.env.EMAIL_MONITOR_ERASE_BEFORE = "2000-01-01T00:00:00.000Z";
    await cleanupExpiredCommunicationMetadata(db, new Date("2026-11-04T12:00:00.000Z"));
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).erasedAt).not.toBeNull();
    expect((await POST(request(body))).status).toBe(204);
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } })).recipients).toEqual([]);
  } finally {
    await db.eventPrivacyHold.updateMany({ where: { eventId: { in: holds.map(h => h.eventId) } }, data: { active: true } });
    if (previousCutoff === undefined) delete process.env.EMAIL_MONITOR_ERASE_BEFORE; else process.env.EMAIL_MONITOR_ERASE_BEFORE = previousCutoff;
    if (previousReference === undefined) delete process.env.EMAIL_MONITOR_POLICY_REFERENCE; else process.env.EMAIL_MONITOR_POLICY_REFERENCE = previousReference;
  }
});

it("reconciles matched metadata only, preserves webhook evidence, and invents no delivery timestamps", async () => {
  const id = randomUUID(), rfc = `<${randomUUID()}@example.invalid>`;
  const row = await db.emailDelivery.create({ data: { provider: "smtp", providerMessageId: rfc, status: "SENT", sentAt: new Date(), recipients: ["synthetic-recipient@example.invalid"] } });
  const unrelated = randomUUID();
  const read = async () => ({ hasMore: false, messages: [{ id, messageId: rfc, to: ["synthetic-recipient@example.invalid"], createdAt: new Date().toISOString(), status: "delivered" }, { id: unrelated, messageId: "<unrelated@example.invalid>", to: ["unrelated@example.invalid"], createdAt: new Date().toISOString(), status: "sent" }] });
  expect(await reconcileRecentResendMessages(db, read, new Date(Date.now() - 3600000))).toMatchObject({ matched: 1, pages: 1 });
  const reconciled = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
  expect(reconciled).toMatchObject({ provider: "resend", reconciledStatus: "DELIVERED", providerStatus: null, deliveredAt: null });
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: row.id } })).toBe(0);
  expect(await db.emailDelivery.count({ where: { resendEmailId: unrelated } })).toBe(0);
  expect((await listMonitoredEmails(db, f.adminActor, { q: id, status: "DELIVERED" })).messages[0]?.id).toBe(row.id);
  await expect(reconcileRecentResendMessages(db, async () => { throw new Error("PRIVATE_PROVIDER_ERROR"); }, new Date())).rejects.toThrow("RESEND_RECONCILIATION_FAILED");
});
