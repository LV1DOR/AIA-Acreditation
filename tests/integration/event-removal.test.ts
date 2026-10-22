import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { removeCompanyFromEvent, removePersonFromEvent } from "../../packages/domain/src/admin/event-removal.ts";
import { registrationCapabilities } from "../../packages/domain/src/submissions/capabilities.ts";
import { companyRequests } from "../../packages/domain/src/requests/service.ts";
import { leaderOverview, leaderRegistration } from "../../packages/domain/src/portal/queries.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";
afterAll(() => db.$disconnect());
async function approvedFixture() {
  const f = await fixture(db);
  const registration = await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "APPROVED" } });
  const person = await db.eventParticipant.create({ data: { registrationId: registration.id, eventId: f.event.id, fullName: "Synthetic person", status: "LEADER_APPROVED", photoObjectKey: "synthetic/retained-photo" } });
  const snapshot = { synthetic: true, immutable: randomUUID() };
  const submission = await db.companySubmission.create({ data: { registrationId: registration.id, version: 1, registrationVersion: registration.version, snapshot, contentHash: "a".repeat(64), submittedByUserId: f.leader.id } });
  await db.companySubmissionReview.create({ data: { submissionId: submission.id, outcome: "APPROVED", reviewedByUserId: f.admin.id } });
  const review = await db.submissionParticipantReview.create({ data: { submissionId: submission.id, participantId: person.id, outcome: "APPROVED", reviewedByUserId: f.admin.id } });
  const invitation = await db.leaderInvitation.create({ data: { registrationId: registration.id, companyId: f.company.id, emailNormalized: "synthetic@example.invalid", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "b"), createdByUserId: f.admin.id, expiresAt: new Date(Date.now() + 60000) } });
  return { ...f, registration, person, submission, snapshot, review, invitation };
}
it("removes an approved company only from one event, retaining immutable history and other event access", async () => {
  const f = await approvedFixture();
  const otherEvent = await db.event.create({ data: { name: "Other synthetic event", startDate: f.event.startDate, endDate: f.event.endDate, onboardingOpensAt: f.event.onboardingOpensAt, onboardingClosesAt: f.event.onboardingClosesAt, status: "ONBOARDING_OPEN" } });
  const other = await db.companyEventRegistration.create({ data: { companyId: f.company.id, eventId: otherEvent.id, primaryLeaderMembershipId: f.membership.id } });
  const otherPerson = await db.eventParticipant.create({ data: { registrationId: other.id, eventId: otherEvent.id } });
  await removeCompanyFromEvent(db, f.adminActor, { id: f.registration.id, eventId: f.event.id, expectedVersion: f.registration.version });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).withdrawnAt).toBeInstanceOf(Date);
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: f.person.id } })).status).toBe("REMOVED");
  expect((await db.leaderInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).revokedAt).toBeInstanceOf(Date);
  expect(await db.companyEventRegistration.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other);
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id: otherPerson.id } })).toEqual(otherPerson);
  expect(await db.companyLeaderMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).toEqual(f.membership);
  expect((await db.companySubmission.findUniqueOrThrow({ where: { id: f.submission.id } })).snapshot).toEqual(f.snapshot);
  expect(await db.submissionParticipantReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
  expect(await db.storageDeletion.count({ where: { objectKey: f.person.photoObjectKey! } })).toBe(0);
  const rows = await leaderOverview(db, f.leaderActor, "a".repeat(64));
  expect(rows.some(r => r.id === other.id)).toBe(true);
  expect(rows.some(r => r.id === f.registration.id)).toBe(false);
  await expect(leaderRegistration(db, f.leaderActor, f.registration.id, "a".repeat(64))).rejects.toThrow("FORBIDDEN");
  await expect(companyRequests(db, f.leaderActor, f.registration.id)).rejects.toThrow("EDIT_LOCKED");
  expect((await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER")).add).toBe(false);
  // The database also rejects a stale action which would revive active approval.
  await expect(db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "APPROVED" } })).rejects.toThrow();
});
it("removes a person with approved history without invalidating their colleagues", async () => {
  const f = await approvedFixture();
  const colleague = await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, status: "LEADER_APPROVED" } });
  await removePersonFromEvent(db, f.adminActor, { id: f.person.id, eventId: f.event.id, expectedVersion: f.person.version });
  const person = await db.eventParticipant.findUniqueOrThrow({ where: { id: f.person.id } });
  expect(person.status).toBe("REMOVED");
  expect(person.photoObjectKey).toBe(f.person.photoObjectKey);
  expect(person.fullName).toBe(f.person.fullName);
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id: colleague.id } })).toEqual(colleague);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("APPROVED");
  expect((await db.companySubmission.findUniqueOrThrow({ where: { id: f.submission.id } })).snapshot).toEqual(f.snapshot);
  expect(await db.submissionParticipantReview.findUniqueOrThrow({ where: { id: f.review.id } })).toEqual(f.review);
  expect(await db.notification.count({ where: { registrationId: f.registration.id, recipientUserId: f.leader.id } })).toBe(1);
});
it("retries without duplicate notifications and rejects a cross-event identifier", async () => {
  const f = await approvedFixture(), p = { id: f.registration.id, eventId: f.event.id, expectedVersion: f.registration.version };
  await expect(removeCompanyFromEvent(db, f.adminActor, { ...p, eventId: randomUUID() })).rejects.toThrow("NOT_FOUND");
  await removeCompanyFromEvent(db, f.adminActor, p);
  expect((await removeCompanyFromEvent(db, f.adminActor, p)).alreadyRemoved).toBe(true);
  expect(await db.notification.count({ where: { registrationId: f.registration.id } })).toBe(1);
  expect(await db.auditEvent.count({ where: { entityId: f.registration.id, action: "REGISTRATION_REMOVED" } })).toBe(1);
});
