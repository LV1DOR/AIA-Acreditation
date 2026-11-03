import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { readyConfiguration, readyPerson } from "../fixtures/security.ts";
import {
  createCompanyRequest, createParticipant, createParticipantWithInvitation, decideCompanyRequest,
  participantCapabilities, registrationCapabilities, reviewCompanySubmission,
  reviewSubmissionParticipant, submitCompanyRegistration,
} from "../../packages/domain/src/index.ts";
import { protectDocumentNumber } from "../../packages/domain/src/participants/identity.ts";

const key = "a".repeat(64);
const consent = { dataProcessingAccepted: true as const, dataProcessingNoticeVersion: "test-v1" };
afterAll(() => db.$disconnect());
async function submitted() {
  const f = await fixture(db); await readyConfiguration(db, f);
  const first = await readyPerson(db, f, "Unchanged synthetic person");
  const second = await readyPerson(db, f, "Corrected synthetic person");
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...consent }, key);
  return { ...f, first, second, submission };
}
async function resubmit(f: Awaited<ReturnType<typeof submitted>>) {
  const row = await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } });
  return submitCompanyRegistration(db, f.leaderActor, { registrationId: row.id, expectedVersion: row.version, ...consent }, key);
}
async function approved() {
  const f = await submitted();
  for (const person of [f.first, f.second]) await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: person.id, outcome: "APPROVED" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: f.submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  return f;
}
async function grantExtra(f: Awaited<ReturnType<typeof submitted>>, slots = 2) {
  const request = await createCompanyRequest(db, f.leaderActor, { registrationId: f.registration.id, reason: "Synthetic additional staff requirement", payload: { type: "EXTRA_PERSONNEL", additionalSlots: slots } });
  await decideCompanyRequest(db, f.adminActor, { requestId: request.id, expectedVersion: 1, decision: "APPROVE" });
  return request;
}

it("creates manual and link workers only within approved extra capacity, preserves locks and rejects other companies", async () => {
  const f = await approved();
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { personnelLimit: 2 } });
  const grant = await grantExtra(f);
  expect((await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER")).add).toBe(true);
  expect((await participantCapabilities(db, f.first.id, "COMPANY_LEADER")).editable).toBe(false);
  const manual = await createParticipant(db, f.leaderActor, f.registration.id);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  const linked = await db.eventParticipant.findUniqueOrThrow({ where: { id: link.participantId } });
  expect(manual.editRequestId).toBe(grant.id); expect(linked.editRequestId).toBe(grant.id);
  expect((await participantCapabilities(db, manual.id, "COMPANY_LEADER")).editable).toBe(true);
  expect((await participantCapabilities(db, linked.id, "COMPANY_LEADER")).editable).toBe(true);
  expect((await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER")).add).toBe(false);
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).rejects.toThrow();
  const other = await fixture(db);
  await expect(createParticipant(db, other.leaderActor, f.registration.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("allows approved manual extra capacity after deadline but does not issue employee links", async () => {
  const f = await approved(); await grantExtra(f);
  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() - 60_000) } });
  const capabilities = await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER");
  expect(capabilities.add).toBe(true); expect(capabilities.employeeLinks).toBe(false);
  expect((await createParticipant(db, f.leaderActor, f.registration.id)).editRequestId).not.toBeNull();
  await expect(createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000))).rejects.toMatchObject({ code: "EDIT_LOCKED" });
});

it("does not create an add-worker exception from a photo correction without an approved capacity grant", async () => {
  const f = await submitted();
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: f.first.id, outcome: "APPROVED" });
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: f.second.id, outcome: "RETURNED_FOR_CORRECTION", reason: "PHOTO", comment: "Synthetic photo correction" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: f.submission.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "PERSONNEL", comment: "Correct the selected synthetic person" });
  expect((await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER")).add).toBe(false);
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).rejects.toMatchObject({ code: "EDIT_LOCKED" });
});

it("carries unchanged review and latest adjusted photo, records provenance, and keeps changed people pending", async () => {
  const f = await submitted();
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: f.first.id, outcome: "APPROVED" });
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: f.second.id, outcome: "RETURNED_FOR_CORRECTION", reason: "PHOTO", comment: "Synthetic correction" });
  await db.submissionPhotoAdjustment.createMany({ data: [
    { submissionId: f.submission.id, participantId: f.first.id, adjustedByUserId: f.admin.id, photoObjectKey: "synthetic/older-adjustment", createdAt: new Date("2026-01-01") },
    { submissionId: f.submission.id, participantId: f.first.id, adjustedByUserId: f.admin.id, photoObjectKey: "synthetic/latest-adjustment", createdAt: new Date("2026-01-02") },
  ] });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: f.submission.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "PERSONNEL", comment: "Synthetic selected-person correction" });
  await db.eventParticipant.update({ where: { id: f.second.id }, data: { photoObjectKey: "synthetic/corrected-photo", status: "LEADER_APPROVED", version: { increment: 1 } } });
  const next = await resubmit(f);
  const reviews = await db.submissionParticipantReview.findMany({ where: { submissionId: next.id } });
  expect(reviews).toHaveLength(1); expect(reviews[0]).toMatchObject({ participantId: f.first.id, outcome: "APPROVED", reviewedByUserId: f.admin.id });
  const photos = await db.submissionPhotoAdjustment.findMany({ where: { submissionId: next.id } });
  expect(photos).toHaveLength(1); expect(photos[0]).toMatchObject({ participantId: f.first.id, photoObjectKey: "synthetic/latest-adjustment", adjustedByUserId: f.admin.id });
  const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: next.id, action: "SUBMISSION_CREATED" } });
  expect(audit.metadata).toMatchObject({ inheritedApprovals: { fromSubmissionId: f.submission.id, participantCount: 1 } });
  expect(await db.submissionPhotoAdjustment.count({ where: { submissionId: f.submission.id } })).toBe(2);
  const row = await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } });
  await expect(reviewCompanySubmission(db, f.adminActor, { submissionId: next.id, expectedRegistrationVersion: row.version, action: "APPROVE" })).rejects.toMatchObject({ code: "SUBMISSION_INCOMPLETE" });
});

it.each(["name", "document", "photo", "workDays"] as const)("does not inherit approval when %s changes", async field => {
  const f = await approved(); await grantExtra(f);
  if (field === "name") await db.eventParticipant.update({ where: { id: f.first.id }, data: { fullName: "Changed synthetic name" } });
  if (field === "photo") await db.eventParticipant.update({ where: { id: f.first.id }, data: { photoObjectKey: "synthetic/new-original-photo" } });
  if (field === "document") await db.eventParticipant.update({ where: { id: f.first.id }, data: protectDocumentNumber("PASSPORT", "DIFFERENT-SYNTHETIC-ID", f.first.id, "1".repeat(64), "2".repeat(64)) });
  if (field === "workDays") await db.participantWorkDay.create({ data: { participantId: f.first.id, workDate: new Date("2026-10-02") } });
  const next = await resubmit(f);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: next.id, participantId: f.first.id } })).toBe(0);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: next.id, participantId: f.second.id, outcome: "APPROVED" } })).toBe(1);
});

it("retains unchanged identity approval through re-encryption, requires new-person review and consumes the grant", async () => {
  const f = await approved(); const grant = await grantExtra(f);
  await db.eventParticipant.update({ where: { id: f.first.id }, data: { ...protectDocumentNumber("PASSPORT", f.first.id, f.first.id, "1".repeat(64), "2".repeat(64)), version: { increment: 1 } } });
  const added = await readyPerson(db, f, "New synthetic person");
  const next = await resubmit(f);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: next.id, outcome: "APPROVED" } })).toBe(2);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: next.id, participantId: added.id } })).toBe(0);
  expect((await db.companyRequest.findUniqueOrThrow({ where: { id: grant.id } })).fulfilledBySubmissionId).toBe(next.id);
  expect((await registrationCapabilities(db, f.registration.id, "COMPANY_LEADER")).add).toBe(false);
});

it("retains only active people and commits one inherited review set under concurrent resubmission", async () => {
  const f = await approved(); await grantExtra(f);
  await db.eventParticipant.update({ where: { id: f.first.id }, data: { status: "REMOVED" } });
  const results = await Promise.allSettled([resubmit(f), resubmit(f)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const latest = await db.companySubmission.findFirstOrThrow({ where: { registrationId: f.registration.id }, orderBy: { version: "desc" } });
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(2);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: latest.id, participantId: f.first.id } })).toBe(0);
  expect(await db.submissionParticipantReview.count({ where: { submissionId: latest.id, participantId: f.second.id, outcome: "APPROVED" } })).toBe(1);
});
