import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { decideVehiclePass, reviewCompanySubmission, reviewSubmissionParticipant, submitCompanyRegistration } from "../../packages/domain/src/index.ts";

afterAll(() => db.$disconnect());
const snapshotKey = "a".repeat(64);

async function readyVehicleRequest() {
  const f = await fixture(db);
  const zone = await db.zone.create({ data: { name: `Vehicle zone ${f.registration.id}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  const vehicle = await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: true, requestedQuantity: 2, justification: "Transport event equipment", requestedAt: new Date() } });
  const person = await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, status: "LEADER_APPROVED", fullName: "Vehicle Test Worker", photoObjectKey: "photos/test/vehicle-worker.jpg" } });
  return { ...f, vehicle, person };
}

it("keeps vehicle approval independent of worker submission approval", async () => {
  const f = await readyVehicleRequest();
  await expect(decideVehiclePass(db, f.adminActor, { vehiclePassId: f.vehicle.id, expectedVersion: 1, decision: "APPROVE" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: submission.id, participantId: f.person.id, outcome: "APPROVED" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("APPROVED");
  expect((await db.vehiclePassRequest.findUniqueOrThrow({ where: { id: f.vehicle.id } })).approvedQuantity).toBeNull();

  await decideVehiclePass(db, f.adminActor, { vehiclePassId: f.vehicle.id, expectedVersion: 1, decision: "APPROVE" });
  const vehicle = await db.vehiclePassRequest.findUniqueOrThrow({ where: { id: f.vehicle.id } });
  expect(vehicle.approvedQuantity).toBe(2);
  expect(vehicle.decidedByUserId).toBe(f.admin.id);
  expect(await db.auditEvent.count({ where: { entityId: vehicle.id, action: "VEHICLE_PASS_APPROVED" } })).toBe(1);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("APPROVED");
  await expect(decideVehiclePass(db, f.adminActor, { vehiclePassId: vehicle.id, expectedVersion: 1, decision: "REJECT", comment: "Decision reconsidered." })).rejects.toMatchObject({ code: "STALE_WRITE" });
});

it("rejects passes without changing a submission still under review", async () => {
  const f = await readyVehicleRequest();
  await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  await expect(decideVehiclePass(db, f.adminActor, { vehiclePassId: f.vehicle.id, expectedVersion: 1, decision: "REJECT" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await decideVehiclePass(db, f.adminActor, { vehiclePassId: f.vehicle.id, expectedVersion: 1, decision: "REJECT", comment: "Insufficient operational justification." });
  const vehicle = await db.vehiclePassRequest.findUniqueOrThrow({ where: { id: f.vehicle.id } });
  expect(vehicle.approvedQuantity).toBe(0);
  expect(vehicle.decisionComment).toBe("Insufficient operational justification.");
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("AIA_REVIEW");
  expect(await db.auditEvent.count({ where: { entityId: f.vehicle.id, action: "VEHICLE_PASS_REJECTED" } })).toBe(1);
});
