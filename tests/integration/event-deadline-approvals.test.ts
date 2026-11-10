import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { readyPerson } from "../fixtures/security.ts";
import { idAllAttendees, reviewCompanySubmission, reviewSubmissionParticipant, submitCompanyRegistration, updateEvent, weBookAttendees, workerEffectiveAccess } from "../../packages/domain/src/index.ts";

afterAll(() => db.$disconnect());
const key = "a".repeat(64);

it.each(["extend", "shorten"])("preserves approved exports, effective access and all registration/worker states when administrators %s only the deadline", async direction => {
  const f = await fixture(db);
  const zone = await db.zone.create({ data: { name: `Synthetic zone ${randomUUID()}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: false } });
  const person = await readyPerson(db, f);
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, dataProcessingAccepted: true, dataProcessingNoticeVersion: "test-v1" }, key);
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: submission.id, participantId: person.id, outcome: "APPROVED" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  for (const status of ["AIA_REVIEW", "RETURNED_FOR_CORRECTION", "DRAFT"] as const) {
    const company = await db.company.create({ data: { name: `Synthetic ${status} ${randomUUID()}` } });
    const registration = await db.companyEventRegistration.create({ data: { companyId: company.id, eventId: f.event.id, status } });
    await db.eventParticipant.create({ data: { registrationId: registration.id, eventId: f.event.id, status: "LEADER_APPROVED", fullName: "Synthetic pending worker" } });
  }
  const registrationsBefore = await db.companyEventRegistration.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } });
  const workersBefore = await db.eventParticipant.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } });
  const submissionBefore = await db.companySubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { reviews: true, participantReviews: true, photoAdjustments: true } });
  const notificationsBefore = await db.notification.count({ where: { eventId: f.event.id } });
  const emailsBefore = await db.outboxMessage.count({ where: { eventId: f.event.id, type: "BUSINESS_EMAIL" } });
  const cardsBefore = await idAllAttendees(db, f.adminActor, f.event.id, key);
  const webookBefore = await weBookAttendees(db, f.adminActor, f.event.id, key);
  const accessBefore = await workerEffectiveAccess(db, f.adminActor, person.id, key);
  const deadline = new Date(direction === "extend" ? f.event.onboardingClosesAt.getTime() + 86400000 : Date.now() - 3600000);
  await updateEvent(db, f.adminActor, { id: f.event.id, expectedVersion: f.event.version, name: f.event.name, startDate: f.event.startDate.toISOString().slice(0, 10), endDate: f.event.endDate.toISOString().slice(0, 10), onboardingOpensAt: f.event.onboardingOpensAt.toISOString(), onboardingClosesAt: deadline.toISOString(), timezone: f.event.timezone, publicationState: "PUBLISHED" });
  const event = await db.event.findUniqueOrThrow({ where: { id: f.event.id } });
  expect(event.onboardingClosesAt).toEqual(deadline);expect(event.version).toBe(f.event.version + 1);
  expect(await db.companyEventRegistration.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } })).toEqual(registrationsBefore);
  expect(await db.eventParticipant.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } })).toEqual(workersBefore);
  expect(await db.companySubmission.findUniqueOrThrow({ where: { id: submission.id }, include: { reviews: true, participantReviews: true, photoAdjustments: true } })).toEqual(submissionBefore);
  expect(await db.notification.count({ where: { eventId: f.event.id } })).toBe(notificationsBefore);
  expect(await db.outboxMessage.count({ where: { eventId: f.event.id, type: "BUSINESS_EMAIL" } })).toBe(emailsBefore);
  expect(await idAllAttendees(db, f.adminActor, f.event.id, key)).toEqual(cardsBefore);
  expect(await weBookAttendees(db, f.adminActor, f.event.id, key)).toEqual(webookBefore);
  expect(await workerEffectiveAccess(db, f.adminActor, person.id, key)).toEqual(accessBefore);
  expect(await db.auditEvent.count({ where: { eventId: f.event.id, action: "APPROVAL_INVALIDATED" } })).toBe(0);
});
