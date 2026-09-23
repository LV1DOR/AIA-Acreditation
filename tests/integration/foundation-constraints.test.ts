import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
afterAll(() => db.$disconnect());
it("enforces unique registrations, positive limits and event dates", async () => {
  const f = await fixture(db);
  expect(f.registration.personnelLimit).toBe(10);
  await expect(db.companyEventRegistration.create({ data: { eventId: f.event.id, companyId: f.company.id } })).rejects.toThrow();
  await expect(db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { personnelLimit: 0 } })).rejects.toThrow();
  await expect(db.event.update({ where: { id: f.event.id }, data: { endDate: new Date("2026-09-01") } })).rejects.toThrow();
  await expect(db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: f.event.onboardingOpensAt } })).rejects.toThrow();
});
it("rejects cross-company primary leaders and cross-event zones at DB level", async () => {
  const a = await fixture(db), b = await fixture(db);
  await expect(db.companyEventRegistration.update({ where: { id: a.registration.id }, data: { primaryLeaderMembershipId: b.membership.id } })).rejects.toThrow();
  const zone = await db.zone.create({ data: { name: "Synthetic zone" } });
  await db.eventZone.create({ data: { eventId: b.event.id, zoneId: zone.id } });
  await expect(db.companyZoneRequest.create({ data: { registrationId: a.registration.id, eventId: b.event.id, zoneId: zone.id } })).rejects.toThrow();
  await expect(db.companyZoneRequest.create({ data: { registrationId: a.registration.id, eventId: a.event.id, zoneId: zone.id } })).rejects.toThrow();
});
it("requires vehicle justification and complete decision metadata", async () => {
  const f = await fixture(db);
  await expect(db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: true, requestedQuantity: 1, justification: " " } })).rejects.toThrow();
  await expect(db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, approvedQuantity: 0 } })).rejects.toThrow();
  await expect(db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, decidedAt: new Date(), decidedByUserId: f.admin.id } })).rejects.toThrow();
});
