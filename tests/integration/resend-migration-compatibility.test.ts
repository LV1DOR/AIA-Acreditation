import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { emailMetadataHash } from "../../packages/domain/src/notifications/email-monitoring.ts";
afterAll(() => db.$disconnect());
it("allows the existing runtime role to use new tables and old sending-column SQL", async () => {
  const outboxId = randomUUID(), id = randomUUID(), providerId = randomUUID();
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE aia_runtime");
    await tx.$executeRaw`INSERT INTO "OutboxMessage" (id,"deduplicationKey",type,payload,"processedAt") VALUES (${outboxId}::uuid,${"synthetic-legacy-" + id},'SYNTHETIC_REHEARSAL','{}',CURRENT_TIMESTAMP)`;
    await tx.$executeRaw`INSERT INTO "EmailDelivery" (id,"outboxMessageId",provider,"providerMessageId",status,"updatedAt") VALUES (${id}::uuid,${outboxId}::uuid,'smtp','<synthetic@example.invalid>','SENT',CURRENT_TIMESTAMP)`;
    await tx.emailProviderIdentity.create({ data: { idHash: emailMetadataHash(providerId), resendEmailId: providerId, emailDeliveryId: id } });
    await tx.emailDeliveryEvent.create({ data: { emailDeliveryId: id, resendEmailId: providerId, svixId: "synthetic-" + randomUUID(), payloadDigest: "a".repeat(64), type: "email.sent", occurredAt: new Date() } });
    expect(await tx.emailDeliveryEvent.count({ where: { emailDeliveryId: id } })).toBe(1);
  });
  expect(await db.emailDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "SENT", recipients: [] });
});
it("lets the existing erasure role redact new metadata through the old update boundary", async () => {
  const id = randomUUID(), providerId = randomUUID();
  await db.emailDelivery.create({ data: { id, recipients: ["synthetic@example.invalid"], recipientHash: "a".repeat(64), subject: "Synthetic subject", sender: "sender@example.invalid", senderDomain: "example.invalid", providerMessageId: "<synthetic@example.invalid>", resendEmailId: providerId, resendIdHash: emailMetadataHash(providerId) } });
  await db.emailProviderIdentity.create({ data: { idHash: emailMetadataHash(providerId), resendEmailId: providerId, emailDeliveryId: id } });
  await db.emailDeliveryEvent.create({ data: { emailDeliveryId: id, resendEmailId: providerId, svixId: "synthetic-" + randomUUID(), payloadDigest: "b".repeat(64), type: "email.delivered", occurredAt: new Date(), providerMessage: "Synthetic diagnostic" } });
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE aia_privacy_owner");
    await tx.$executeRaw`UPDATE "EmailDelivery" SET "recipientHash"=NULL,"providerMessageId"=NULL,"lastFailureCode"='PRIVACY_ERASURE' WHERE id=${id}::uuid`;
  });
  expect(await db.emailDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({ recipients: [], subject: null, sender: null, senderDomain: null, resendEmailId: null });
  expect(await db.emailDeliveryEvent.count({ where: { emailDeliveryId: id } })).toBe(0);
  expect(await db.emailProviderIdentity.findUniqueOrThrow({ where: { idHash: emailMetadataHash(providerId) } })).toMatchObject({ resendEmailId: null, emailDeliveryId: id });
});
