import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { transaction } from "../../packages/domain/src/shared/transaction.ts";
import { resolveActor } from "../../packages/domain/src/auth/authorization.ts";
import { appendAudit } from "../../packages/domain/src/audit/append.ts";
import { enqueueInvalidation } from "../../packages/domain/src/notifications/outbox.ts";
import { createCompany, configureRegistration } from "../../packages/domain/src/index.ts";
afterAll(() => db.$disconnect());
it("rolls business data and audit back if outbox insertion fails", async () => {
  const f = await fixture(db), id = randomUUID(), key = randomUUID();
  await db.outboxMessage.create({ data: { deduplicationKey: key, type: "TEST", payload: {} } });
  await expect(transaction(db, async tx => {
    const actor = await resolveActor(tx, f.adminActor);
    await tx.company.create({ data: { id, name: "Synthetic rollback" } });
    await appendAudit(tx, actor, { action: "COMPANY_CREATED", entityType: "Company", entityId: id });
    await enqueueInvalidation(tx, key, { entityId: id, version: 1 });
  })).rejects.toThrow();
  expect(await db.company.findUnique({ where: { id } })).toBeNull();
  expect(await db.auditEvent.count({ where: { entityId: id } })).toBe(0);
});
it("audit history cannot be edited or deleted", async () => {
  const f = await fixture(db);
  const company = await createCompany(db, f.adminActor, { name: "Synthetic append only" });
  const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: company.id } });
  await expect(db.auditEvent.update({ where: { id: audit.id }, data: { action: "CHANGED" } })).rejects.toThrow();
  await expect(db.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow();
});
it("rolls registration, vehicle, notification and audit back together", async () => {
  const f = await fixture(db);
  await db.outboxMessage.create({ data: { deduplicationKey: "registration:" + f.registration.id + ":2", type: "TEST", payload: {} } });
  await expect(configureRegistration(db, f.adminActor, {
    registrationId: f.registration.id, expectedVersion: 1, zoneIds: [],
    vehicle: { required: false, requestedQuantity: 0, justification: null }
  })).rejects.toThrow();
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).version).toBe(1);
  expect(await db.vehiclePassRequest.count({ where: { registrationId: f.registration.id } })).toBe(0);
  expect(await db.notification.count({ where: { registrationId: f.registration.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { entityId: f.registration.id } })).toBe(0);
});
