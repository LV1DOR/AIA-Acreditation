import { createHash, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { transaction } from "../../packages/domain/src/shared/transaction.ts";
import { queueBusinessEmail, deliverNextBusinessEmail, enqueueDueDeadlineReminders } from "../../packages/domain/src/notifications/business-email.ts";
import { enqueueInvalidation, publishNextInvalidation } from "../../packages/domain/src/notifications/outbox.ts";

afterAll(() => db.$disconnect());

it("tracks business email delivery without storing the recipient address", async () => {
  await db.outboxMessage.updateMany({ where: { type: "BUSINESS_EMAIL", processedAt: null }, data: { processedAt: new Date(), payload: {} } });
  const f = await fixture(db), key = `synthetic-business-email:${randomUUID()}`;
  await transaction(db, tx => queueBusinessEmail(tx, key, { recipientUserId: f.leader.id, template: "REQUEST_APPROVED", companyName: f.company.name, eventName: f.event.name, path: "/portal" }));
  const row = await db.outboxMessage.findUniqueOrThrow({ where: { deduplicationKey: key } });
  expect(JSON.stringify(row.payload)).not.toContain("leader@example.invalid");
  let rendered = "";
  const transport = { send: async (message: { html: string }) => { rendered = message.html; return { provider: "smtp" as const, messageId: "synthetic-message" }; }, close() {} };
  expect(await deliverNextBusinessEmail(db, transport, "https://portal.example.invalid", async () => "leader@example.invalid")).toBe("SENT");
  expect(rendered).toContain("Pedido aprovado / Request approved");
  const delivery = await db.emailDelivery.findUniqueOrThrow({ where: { outboxMessageId: row.id } });
  expect(delivery).toMatchObject({ status: "SENT", provider: "smtp", providerMessageId: "synthetic-message", attempts: 1 });
  expect(delivery.recipientHash).toBe(createHash("sha256").update("leader@example.invalid").digest("hex"));
  expect((await db.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).payload).toEqual({});
});

it("publishes only non-sensitive invalidation metadata and completes the outbox row", async () => {
  await db.outboxMessage.updateMany({ where: { type: "DOMAIN_INVALIDATION", processedAt: null }, data: { processedAt: new Date(), payload: {} } });
  const f = await fixture(db), key = `synthetic-invalidation:${randomUUID()}`;
  await transaction(db, tx => enqueueInvalidation(tx, key, { entityId: f.registration.id, eventId: f.event.id, version: 1 }));
  let published = "";
  expect(await publishNextInvalidation(db, async message => { published = message; })).toBe("PUBLISHED");
  expect(JSON.parse(published)).toEqual({ type: "invalidate", scope: "portal" });
  expect(published).not.toContain(f.registration.id);
  expect((await db.outboxMessage.findUniqueOrThrow({ where: { deduplicationKey: key } })).processedAt).not.toBeNull();
});

it("queues each deadline reminder once", async () => {
  const f = await fixture(db), now = new Date("2026-09-27T10:00:00.000Z");
  await db.event.update({ where: { id: f.event.id }, data: { onboardingOpensAt: new Date("2026-09-26T09:00:00.000Z"), onboardingClosesAt: new Date("2026-09-30T09:00:00.000Z") } });
  expect(await enqueueDueDeadlineReminders(db, now)).toBeGreaterThanOrEqual(1);
  expect(await enqueueDueDeadlineReminders(db, now)).toBe(0);
  const row = await db.outboxMessage.findUniqueOrThrow({ where: { deduplicationKey: `deadline-reminder:${f.registration.id}:3` } });
  expect(row.type).toBe("BUSINESS_EMAIL");
});
