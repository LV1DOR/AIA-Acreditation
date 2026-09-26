import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { adminSubmissionPhotoAccess, decryptSubmissionSnapshot, recordSubmissionPhotoAdjustment, reopenApprovedRegistration, reviewCompanySubmission, submitCompanyRegistration } from "../../packages/domain/src/index.ts";

afterAll(() => db.$disconnect());
const snapshotKey = "a".repeat(64);

async function readyRegistration() {
  const f = await fixture(db);
  const zone = await db.zone.create({ data: { name: `Zone ${f.registration.id}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: false } });
  await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, status: "LEADER_APPROVED", fullName: "Ready Person", photoObjectKey: "photos/test/ready.jpg" } });
  return f;
}

it("creates immutable, versioned snapshots and locks the mutable workspace", async () => {
  const f = await readyRegistration();
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  expect(submission.version).toBe(1);
  expect(submission.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("AIA_REVIEW");
  await db.company.update({ where: { id: f.company.id }, data: { name: "Changed after submission" } });
  const stored = await db.companySubmission.findUniqueOrThrow({ where: { id: submission.id } });
  expect(JSON.stringify(stored.snapshot)).not.toContain(f.company.name);
  expect((decryptSubmissionSnapshot(stored.snapshot, snapshotKey, stored.id) as { company: { name: string } }).company.name).toBe(f.company.name);
  await expect(db.companySubmission.update({ where: { id: stored.id }, data: { contentHash: "0".repeat(64) } })).rejects.toThrow();
  await expect(submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 2 }, snapshotKey)).rejects.toMatchObject({ code: "EDIT_LOCKED" });
  expect(await db.auditEvent.count({ where: { entityId: submission.id, action: "SUBMISSION_CREATED" } })).toBe(1);
});

it("requires reasons for corrective decisions and creates a new version after resubmission", async () => {
  const f = await readyRegistration();
  const first = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  await expect(reviewCompanySubmission(db, f.adminActor, { submissionId: first.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "OTHER", comment: "" })).rejects.toThrow();
  await reviewCompanySubmission(db, f.adminActor, { submissionId: first.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "DOCUMENT", comment: "Confirm the document." });
  const second = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3 }, snapshotKey);
  expect(second.version).toBe(2);
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(2);
  const review = await db.companySubmissionReview.findFirstOrThrow({ where: { submissionId: first.id } });
  expect(review.outcome).toBe("RETURNED_FOR_CORRECTION");
  await expect(db.companySubmissionReview.update({ where: { id: review.id }, data: { comment: "Changed" } })).rejects.toThrow();
});

it("allows one review decision and invalidates approval only when reopening before deadline", async () => {
  const f = await readyRegistration();
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  const decisions = await Promise.allSettled([
    reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" }),
    reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" }),
  ]);
  expect(decisions.filter(item => item.status === "fulfilled")).toHaveLength(1);
  await reopenApprovedRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3 });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("DRAFT");
  expect(await db.companySubmissionReview.count({ where: { submissionId: submission.id, outcome: "APPROVAL_INVALIDATED" } })).toBe(1);

  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "APPROVED", version: { increment: 1 } } });
  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() - 1000) } });
  await expect(reopenApprovedRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 5 })).rejects.toMatchObject({ code: "DEADLINE_CLOSED" });
});

it("rejects a stale concurrent submission before creating a second snapshot", async () => {
  const f = await readyRegistration();
  const results = await Promise.allSettled([
    submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey),
    submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey),
  ]);
  expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(1);
});

it("stores AIA photo framing as an immutable submission-scoped derivative", async () => {
  const f = await readyRegistration();
  const participant = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: f.registration.id } });
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1 }, snapshotKey);
  const key = `photos/test/${submission.id}/${participant.id}/adjusted.jpg`;
  const adjustment = await recordSubmissionPhotoAdjustment(db, f.adminActor, { submissionId: submission.id, participantId: participant.id, photoObjectKey: key });
  expect(await adminSubmissionPhotoAccess(db, f.adminActor, submission.id, participant.id)).toBe(key);
  await expect(adminSubmissionPhotoAccess(db, f.leaderActor, submission.id, participant.id)).rejects.toThrow("FORBIDDEN");
  await expect(db.submissionPhotoAdjustment.update({ where: { id: adjustment.id }, data: { photoObjectKey: "changed" } })).rejects.toThrow();
  expect(await db.auditEvent.count({ where: { entityId: adjustment.id, action: "SUBMISSION_PHOTO_ADJUSTED" } })).toBe(1);
});
