import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { jobRoles, permanentlyDeleteCompany, permanentlyDeleteParticipant, zones } from "../../packages/domain/src/index.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";

afterAll(() => db.$disconnect());

it("permanently deletes a person and clears dependent active records", async () => {
  const f = await fixture(db);
  const participant = await db.eventParticipant.create({ data: {
    registrationId: f.registration.id, eventId: f.event.id, fullName: "Delete Person", status: "LEADER_APPROVED", photoObjectKey: "photos/test/delete-person.jpg",
  } });
  await db.participantWorkDay.create({ data: { participantId: participant.id, workDate: new Date("2026-10-01T00:00:00.000Z") } });
  await db.employeeInvitationToken.create({ data: { participantId: participant.id, tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "a"), expiresAt: new Date(Date.now() + 60_000), createdByUserId: f.leader.id } });
  const request = await db.companyRequest.create({ data: { registrationId: f.registration.id, targetParticipantId: participant.id, createdByUserId: f.leader.id, type: "OTHER", reason: "Test deletion", payload: {} } });

  const result = await permanentlyDeleteParticipant(db, f.adminActor, { id: participant.id });

  expect(result.photoObjectKeys).toEqual(["photos/test/delete-person.jpg"]);
  expect(await db.eventParticipant.findUnique({ where: { id: participant.id } })).toBeNull();
  expect(await db.participantWorkDay.count({ where: { participantId: participant.id } })).toBe(0);
  expect((await db.companyRequest.findUniqueOrThrow({ where: { id: request.id } })).targetParticipantId).toBeNull();
  expect(await db.auditEvent.count({ where: { entityId: participant.id, action: "PARTICIPANT_DELETED" } })).toBe(1);
});

it("permanently deletes a company and all of its event registrations", async () => {
  const f = await fixture(db);
  const participant = await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, fullName: "Company Person", photoObjectKey: "photos/test/company-person.jpg" } });
  await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: false } });
  await db.notification.create({ data: { recipientUserId: f.leader.id, registrationId: f.registration.id, eventId: f.event.id, type: "REGISTRATION_UPDATED", parameters: {}, deduplicationKey: randomUUID() } });

  const result = await permanentlyDeleteCompany(db, f.adminActor, { id: f.company.id });

  expect(result.photoObjectKeys).toContain("photos/test/company-person.jpg");
  expect(await db.company.findUnique({ where: { id: f.company.id } })).toBeNull();
  expect(await db.companyEventRegistration.findUnique({ where: { id: f.registration.id } })).toBeNull();
  expect(await db.eventParticipant.findUnique({ where: { id: participant.id } })).toBeNull();
  expect(await db.companyLeaderMembership.count({ where: { companyId: f.company.id } })).toBe(0);
  expect(await db.auditEvent.count({ where: { entityId: f.company.id, action: "COMPANY_DELETED" } })).toBe(1);
});

it("deletes unused catalogue entries and blocks deletion while referenced", async () => {
  const f = await fixture(db);
  const unusedZone = await zones.create(db, f.adminActor, { name: `Unused zone ${randomUUID()}` });
  await zones.delete(db, f.adminActor, { id: unusedZone.id });
  expect(await db.zone.findUnique({ where: { id: unusedZone.id } })).toBeNull();

  const role = await jobRoles.create(db, f.adminActor, { name: `Used role ${randomUUID()}` });
  await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, jobRoleId: role.id } });
  await expect(jobRoles.delete(db, f.adminActor, { id: role.id })).rejects.toMatchObject({ code: "CATALOGUE_IN_USE" });
});
