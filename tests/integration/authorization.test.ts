import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { createCompany, configureRegistration } from "../../packages/domain/src/index.ts";
afterAll(() => db.$disconnect());
const vehicle = { required: false as const, requestedQuantity: 0 as const, justification: null };
it("checks individual identity, database role and disabled status", async () => {
  const f = await fixture(db);
  await expect(createCompany(db, f.leaderActor, { name: "Denied" })).rejects.toThrow("FORBIDDEN");
  await db.user.update({ where: { id: f.admin.id }, data: { disabledAt: new Date() } });
  await expect(createCompany(db, f.adminActor, { name: "Denied" })).rejects.toThrow("FORBIDDEN");
});
it("rejects other-company and revoked membership access", async () => {
  const f = await fixture(db), other = await fixture(db);
  const input = { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [], vehicle };
  await expect(configureRegistration(db, other.leaderActor, input)).rejects.toThrow("FORBIDDEN");
  await db.companyLeaderMembership.update({ where: { id: f.membership.id }, data: { revokedAt: new Date() } });
  await expect(configureRegistration(db, f.leaderActor, input)).rejects.toThrow("FORBIDDEN");
});
it.each(["AIA_REVIEW", "APPROVED", "REJECTED"] as const)("rejects direct leader mutation of %s", async status => {
  const f = await fixture(db);
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status } });
  await expect(configureRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [], vehicle })).rejects.toThrow("EDIT_LOCKED");
});
it("enforces deadline even if status is still open; audited admin override works", async () => {
  const f = await fixture(db);
  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() - 1000) } });
  const input = { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [], vehicle };
  await expect(configureRegistration(db, f.leaderActor, input)).rejects.toThrow("DEADLINE_CLOSED");
  await expect(configureRegistration(db, f.adminActor, input)).rejects.toThrow("OVERRIDE_REASON_REQUIRED");
  await configureRegistration(db, f.adminActor, { ...input, overrideReason: "OTHER" });
  const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: f.registration.id } });
  expect(audit.metadata).toMatchObject({ override: true, reasonCategory: "OTHER" });
  expect(await db.notification.count({ where: { registrationId: f.registration.id } })).toBe(1);
  expect(await db.outboxMessage.count({ where: { deduplicationKey: "registration:" + f.registration.id + ":2" } })).toBe(1);
});
