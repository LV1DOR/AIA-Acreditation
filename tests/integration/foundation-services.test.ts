import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import {
  activateEventZone, configureRegistration, createCompany, createEvent, createRegistration,
  deactivateEventZone, jobRoles, updateCompany, updateEvent, updatePersonnelLimit, zones,
} from "../../packages/domain/src/index.ts";
afterAll(() => db.$disconnect());
it("sets up an event/company with catalogues and company-wide zone/vehicle choices", async () => {
  const f = await fixture(db);
  const event = await createEvent(db, f.adminActor, {
    name: "Synthetic service event", startDate: "2026-10-01", endDate: "2026-10-03",
    onboardingOpensAt: "2026-09-01T00:00:00Z", onboardingClosesAt: "2026-09-30T00:00:00Z",
  });
  expect(event.status).toBe("DRAFT");
  expect(event.timezone).toBe("Europe/Lisbon");
  const company = await createCompany(db, f.adminActor, { name: "Synthetic service company" });
  const registration = await createRegistration(db, f.adminActor, { eventId: event.id, companyId: company.id });
  expect(registration.personnelLimit).toBe(10);
  await updatePersonnelLimit(db, f.adminActor, { registrationId: registration.id, expectedVersion: 1, personnelLimit: 25 });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: registration.id } })).personnelLimit).toBe(25);
  await updateEvent(db, f.adminActor, {
    id: event.id, expectedVersion: 1, name: "Synthetic service event updated", status: "ONBOARDING_OPEN",
    startDate: "2026-10-01", endDate: "2026-10-04", onboardingOpensAt: "2026-09-01T00:00:00Z",
    onboardingClosesAt: "2026-09-30T00:00:00Z", timezone: "Europe/Lisbon",
  });
  await expect(updateEvent(db, f.adminActor, {
    id: event.id, expectedVersion: 1, name: "Stale event", status: "DRAFT", startDate: "2026-10-01",
    endDate: "2026-10-04", onboardingOpensAt: "2026-09-01T00:00:00Z",
    onboardingClosesAt: "2026-09-30T00:00:00Z", timezone: "Europe/Lisbon",
  })).rejects.toThrow("STALE_WRITE");
  await updateCompany(db, f.adminActor, { id: company.id, expectedVersion: 1, name: "Synthetic service company updated", active: true });
  const zone = await zones.create(db, f.adminActor, { name: "Synthetic service zone" });
  await activateEventZone(db, f.adminActor, { eventId: f.event.id, zoneId: zone.id });
  const role = await jobRoles.create(db, f.adminActor, { name: "Synthetic role" });
  await jobRoles.update(db, f.adminActor, { id: role.id, name: "Synthetic renamed role", sortOrder: 1, active: false, expectedVersion: 1 });
  await expect(jobRoles.update(db, f.adminActor, { id: role.id, name: "Stale", sortOrder: 0, active: true, expectedVersion: 1 })).rejects.toThrow("STALE_WRITE");
  const request = { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [zone.id], vehicle: { required: true as const, requestedQuantity: 3, justification: "Synthetic logistics reason" } };
  await configureRegistration(db, f.leaderActor, request);
  expect(await db.companyZoneRequest.count({ where: { registrationId: f.registration.id } })).toBe(1);
  const vehicle = await db.vehiclePassRequest.findUniqueOrThrow({ where: { registrationId: f.registration.id } });
  expect(vehicle.requestedQuantity).toBe(3);
  expect(vehicle.approvedQuantity).toBeNull();
  await expect(zones.update(db, f.adminActor, { id: zone.id, expectedVersion: 1, name: zone.name, sortOrder: 0, active: false })).rejects.toThrow("ZONE_IN_USE");
  await expect(deactivateEventZone(db, f.adminActor, { eventId: f.event.id, zoneId: zone.id })).rejects.toThrow("ZONE_IN_USE");
  await configureRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 2, zoneIds: [], vehicle: { required: false, requestedQuantity: 0, justification: null } });
  await deactivateEventZone(db, f.adminActor, { eventId: f.event.id, zoneId: zone.id });
  await activateEventZone(db, f.adminActor, { eventId: f.event.id, zoneId: zone.id });
  await zones.update(db, f.adminActor, { id: zone.id, expectedVersion: 1, name: zone.name, sortOrder: 0, active: false });
  await expect(configureRegistration(db, f.leaderActor, { ...request, expectedVersion: 3 })).rejects.toThrow("INVALID_INPUT");
});
it("accepts an explicit admin limit but rejects invalid event ranges", async () => {
  const f = await fixture(db);
  const company = await createCompany(db, f.adminActor, { name: "Synthetic custom limit company" });
  const registration = await createRegistration(db, f.adminActor, { eventId: f.event.id, companyId: company.id, personnelLimit: 100 });
  expect(registration.personnelLimit).toBe(100);
  await expect(createEvent(db, f.adminActor, {
    name: "Synthetic invalid event", startDate: "2026-10-04", endDate: "2026-10-03",
    onboardingOpensAt: "2026-09-01T00:00:00Z", onboardingClosesAt: "2026-09-30T00:00:00Z",
  })).rejects.toThrow();
});
