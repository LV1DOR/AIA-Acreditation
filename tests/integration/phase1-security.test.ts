import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { readyConfiguration, readyPerson, syntheticPhoto } from "../fixtures/security.ts";
import {
  abandonPhotoUpload, adminSubmissionPhotoAccess, approveParticipant, cleanupNextPhotoUpload,
  companyRequests, configureRegistration, createCompanyRequest, createParticipant, createParticipantWithInvitation,
  decideCompanyRequest, employeeInvitationView, jobRoles, leaderParticipant, leaderRegistration,
  participantPhotoAccess, permanentlyDeleteParticipant, prepareLeaderPhotoUpload, prepareSubmissionPhotoUpload,
  permanentlyDeleteCompany,
  recordSubmissionPhotoAdjustment, removeParticipant, reopenApprovedRegistration, reviewCompanySubmission,
  reviewSubmissionParticipant, submitCompanyRegistration, submitEmployeeOnboarding, updateCompany,
  updateEvent, updateParticipantByLeader, updatePersonnelLimit,
} from "../../packages/domain/src/index.ts";
import { createObjectStorage, processParticipantPhoto } from "../../packages/storage/src/index.ts";
import { parseStorageEnv } from "../../packages/config/src/index.ts";

afterAll(() => db.$disconnect());
const keys = { encryptionKey: "1".repeat(64), fingerprintKey: "2".repeat(64) };
const declaration = { dataProcessingAccepted: true as const, dataProcessingNoticeVersion: "test-v1" };
const input = (jobRoleId: string, documentNumber = randomUUID()) => ({ fullName: "Synthetic Worker", dateOfBirth: "1990-01-01", documentType: "PASSPORT" as const, documentNumber, documentExpiryDate: "2035-01-01", mobile: "+351912345678", nationalityCode: "PT", jobRoleId, workDays: ["2026-10-01"], privacyAcknowledged: true as const, privacyNoticeVersion: "test-v1" });

async function submitted(approved = false) {
  const f = await fixture(db);
  await readyConfiguration(db, f);
  const person = await readyPerson(db, f);
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...declaration }, keys.encryptionKey);
  if (approved) {
    await reviewSubmissionParticipant(db, f.adminActor, { submissionId: submission.id, participantId: person.id, outcome: "APPROVED" });
    await reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  }
  return { ...f, person, submission };
}

it("F01 exact exploit: a link superseded by manual completion cannot change a finally approved worker", async () => {
  const f = await fixture(db);
  await readyConfiguration(db, f);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  const role = await db.jobRole.create({ data: { name: `Synthetic ${randomUUID()}` } });
  await updateParticipantByLeader(db, f.leaderActor, link.participantId, input(role.id), keys, await syntheticPhoto(db, link.participantId));
  await approveParticipant(db, f.leaderActor, link.participantId);
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...declaration }, keys.encryptionKey);
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: submission.id, participantId: link.participantId, outcome: "APPROVED" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  const before = await db.eventParticipant.findUniqueOrThrow({ where: { id: link.participantId } });
  const beforeDays = await db.participantWorkDay.findMany({ where: { participantId: link.participantId } });
  await expect(submitEmployeeOnboarding(db, link.token, { ...input(role.id), fullName: "Unreviewed replacement" }, keys, before.photoObjectKey!)).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id: link.participantId } })).toEqual(before);
  expect(await db.participantWorkDay.findMany({ where: { participantId: link.participantId } })).toEqual(beforeDays);
  expect((await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: link.invitationId } })).revokedAt).not.toBeNull();
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("APPROVED");
});

it.each(["AIA_REVIEW", "APPROVED", "REJECTED"] as const)("F01 checks %s even if an unused link was not revoked", async status => {
  const f = await fixture(db);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  const role = await db.jobRole.create({ data: { name: `Synthetic ${randomUUID()}` } });
  const photo = await syntheticPhoto(db, link.participantId);
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status } });
  await expect(employeeInvitationView(db, link.token)).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  await expect(submitEmployeeOnboarding(db, link.token, input(role.id), keys, photo)).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: link.participantId } })).fullName).toBeNull();
});

it.each(["REMOVED", "REPLACED"] as const)("F01/F34 never resurrects a %s worker", async status => {
  const f = await fixture(db);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  const role = await db.jobRole.create({ data: { name: `Synthetic ${randomUUID()}` } });
  await db.eventParticipant.update({ where: { id: link.participantId }, data: { status } });
  await expect(submitEmployeeOnboarding(db, link.token, input(role.id), keys, "ignored")).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  await expect(updateParticipantByLeader(db, f.leaderActor, link.participantId, input(role.id), keys)).rejects.toMatchObject({ code: "EDIT_LOCKED" });
});

it("F01/F02 concurrent manual and employee completion adopt only one version", async () => {
  const f = await fixture(db);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  const role = await db.jobRole.create({ data: { name: `Synthetic ${randomUUID()}` } });
  const [manualPhoto, employeePhoto] = await Promise.all([syntheticPhoto(db, link.participantId), syntheticPhoto(db, link.participantId)]);
  const results = await Promise.allSettled([
    updateParticipantByLeader(db, f.leaderActor, link.participantId, { ...input(role.id), fullName: "Manual Worker" }, keys, manualPhoto),
    submitEmployeeOnboarding(db, link.token, { ...input(role.id), fullName: "Employee Worker" }, keys, employeePhoto),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const person = await db.eventParticipant.findUniqueOrThrow({ where: { id: link.participantId } });
  expect(person.fullName).toBe(person.photoObjectKey === manualPhoto ? "Manual Worker" : "Employee Worker");
  expect(await db.photoUpload.count({ where: { objectKey: { in: [manualPhoto, employeePhoto] }, status: "ADOPTED" } })).toBe(1);
});

it("F03 suspends direct leader reads, photos, actions, requests and previously valid worker links; admins retain history", async () => {
  const f = await fixture(db);
  const person = await readyPerson(db, f);
  const link = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, new Date(Date.now() + 60_000));
  await updateCompany(db, f.adminActor, { id: f.company.id, expectedVersion: 1, name: f.company.name, active: false });
  const attempts = await Promise.allSettled([
    leaderRegistration(db, f.leaderActor, f.registration.id, keys.encryptionKey), leaderParticipant(db, f.leaderActor, person.id, keys.encryptionKey),
    participantPhotoAccess(db, f.leaderActor, person.id), createParticipant(db, f.leaderActor, f.registration.id),
    companyRequests(db, f.leaderActor, f.registration.id), configureRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [], vehicle: { required: false, requestedQuantity: 0, justification: null } }),
    approveParticipant(db, f.leaderActor, person.id), removeParticipant(db, f.leaderActor, person.id),
    submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...declaration }, keys.encryptionKey),
    createCompanyRequest(db, f.leaderActor, { registrationId: f.registration.id, reason: "Synthetic request", payload: { type: "OTHER" } }),
    updateParticipantByLeader(db, f.leaderActor, person.id, input(person.jobRoleId!), keys),
  ]);
  for (const result of attempts) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(employeeInvitationView(db, link.token)).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  await expect(submitEmployeeOnboarding(db, link.token, input(person.jobRoleId!), keys, "ignored")).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  expect(await participantPhotoAccess(db, f.adminActor, person.id)).toBe(person.photoObjectKey);
  expect((await leaderRegistration(db, f.adminActor, f.registration.id, keys.encryptionKey)).id).toBe(f.registration.id);
  await updateCompany(db, f.adminActor, { id: f.company.id, expectedVersion: 2, name: f.company.name, active: true });
  expect((await leaderParticipant(db, f.leaderActor, person.id, keys.encryptionKey)).participant.id).toBe(person.id);
  await expect(employeeInvitationView(db, link.token)).rejects.toMatchObject({ code: "TOKEN_UNAVAILABLE" });
  expect((await db.companyLeaderMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).revokedAt).toBeNull();
});

it.each(["CHANGE_WORK_DAYS", "REMOVE_AFTER_DEADLINE", "REPLACE_PERSON", "EXTRA_PERSONNEL", "ZONE_CHANGE"] as const)("F09 %s invalidates effective final approval and preserves the original decision", async type => {
  const f = await submitted(true);
  const zone = await db.companyZoneRequest.findFirstOrThrow({ where: { registrationId: f.registration.id } });
  const payload = type === "CHANGE_WORK_DAYS" ? { type, workDays: ["2026-10-02"] } : type === "REPLACE_PERSON" ? { type, replacementName: "Replacement Worker" } : type === "EXTRA_PERSONNEL" ? { type, additionalSlots: 1 } : type === "ZONE_CHANGE" ? { type, zoneIds: [zone.zoneId] } : { type };
  const targetParticipantId = ["CHANGE_WORK_DAYS", "REMOVE_AFTER_DEADLINE", "REPLACE_PERSON"].includes(type) ? f.person.id : undefined;
  const request = await createCompanyRequest(db, f.leaderActor, { registrationId: f.registration.id, targetParticipantId, reason: "Synthetic approved amendment", payload });
  await decideCompanyRequest(db, f.adminActor, { requestId: request.id, expectedVersion: 1, decision: "APPROVE" });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("RETURNED_FOR_CORRECTION");
  expect(await db.companySubmissionReview.count({ where: { submissionId: f.submission.id, outcome: "APPROVED" } })).toBe(1);
  expect(await db.companySubmissionReview.count({ where: { submissionId: f.submission.id, outcome: "APPROVAL_INVALIDATED" } })).toBe(1);
  expect(await db.auditEvent.count({ where: { entityId: f.registration.id, action: "APPROVAL_INVALIDATED" } })).toBe(1);
  if (type === "CHANGE_WORK_DAYS") {
    expect((await db.participantWorkDay.findFirstOrThrow({ where: { participantId: f.person.id } })).workDate.toISOString().slice(0, 10)).toBe("2026-10-02");
    await approveParticipant(db,f.leaderActor,f.person.id);
    const current = await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } });
    const next = await submitCompanyRegistration(db, f.leaderActor, { registrationId: current.id, expectedVersion: current.version, ...declaration }, keys.encryptionKey);
    expect(next.version).toBe(2);
    expect((await db.companyRequest.findUniqueOrThrow({ where: { id: request.id } })).fulfilledBySubmissionId).toBe(next.id);
  }
});

it("F09 admin permanent deletion preserves submitted evidence and approved composition", async () => {
  const f = await submitted(true);
  await expect(permanentlyDeleteParticipant(db, f.adminActor, { id: f.person.id })).rejects.toMatchObject({ code: "SNAPSHOT_WORKFLOW_REQUIRED" });
  expect(await db.eventParticipant.findUnique({ where: { id: f.person.id } })).not.toBeNull();
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("APPROVED");
  await expect(permanentlyDeleteCompany(db, f.adminActor, { id: f.company.id })).rejects.toMatchObject({ code: "APPROVED_COMPANY_DELETE_FORBIDDEN" });
  await reopenApprovedRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3 });
  await expect(permanentlyDeleteCompany(db, f.adminActor, { id: f.company.id })).rejects.toMatchObject({ code: "SNAPSHOT_WORKFLOW_REQUIRED" });
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(1);
});

it("F02 rejects competing AIA adjustments from the same reviewed generation", async () => {
  const f = await submitted();
  const first = await prepareSubmissionPhotoUpload(db, f.adminActor, f.submission.id, f.person.id, "aia-phase1-synthetic");
  const second = await prepareSubmissionPhotoUpload(db, f.adminActor, f.submission.id, f.person.id, "aia-phase1-synthetic");
  const results = await Promise.allSettled([first, second].map(upload => recordSubmissionPhotoAdjustment(db, f.adminActor, { submissionId: f.submission.id, participantId: f.person.id, photoObjectKey: upload.objectKey })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.submissionPhotoAdjustment.count({ where: { submissionId: f.submission.id, participantId: f.person.id } })).toBe(1);
});

it.each(["expiry", "workDates", "role", "zone", "missing", "capacity", "draftEvent"] as const)("F12 final submission and AIA approval reject current invalid %s despite stale status", async defect => {
  const f = await submitted();
  if (defect === "expiry") await db.event.update({ where: { id: f.event.id }, data: { endDate: new Date("2036-01-01") } });
  if (defect === "workDates") await db.event.update({ where: { id: f.event.id }, data: { startDate: new Date("2026-10-02") } });
  if (defect === "role") await db.jobRole.update({ where: { id: f.person.jobRoleId! }, data: { deactivatedAt: new Date() } });
  if (defect === "zone") await db.eventZone.updateMany({ where: { eventId: f.event.id }, data: { deactivatedAt: new Date() } });
  if (defect === "missing") await db.eventParticipant.update({ where: { id: f.person.id }, data: { dateOfBirth: null } });
  if (defect === "capacity") { await readyPerson(db, f, "Second Synthetic Worker"); await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { personnelLimit: 1 } }); }
  if (defect === "draftEvent") await db.event.update({ where: { id: f.event.id }, data: { status: "DRAFT" } });
  const people = await db.eventParticipant.findMany({ where: { registrationId: f.registration.id } });
  for (const person of people) await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: person.id, outcome: "APPROVED" });
  await expect(reviewCompanySubmission(db, f.adminActor, { submissionId: f.submission.id, expectedRegistrationVersion: 2, action: "APPROVE" })).rejects.toMatchObject({ code: "SUBMISSION_INCOMPLETE" });
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "DRAFT" } });
  await expect(submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 2, ...declaration }, keys.encryptionKey)).rejects.toMatchObject({ code: defect === "draftEvent" ? "DEADLINE_CLOSED" : "SUBMISSION_INCOMPLETE" });
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(1);
});

it("F12 event extension and role changes invalidate prior approval; administrators cannot reduce capacity below active count", async () => {
  const f = await submitted(true);
  await expect(updatePersonnelLimit(db, f.adminActor, { registrationId: f.registration.id, expectedVersion: 3, personnelLimit: 1 })).resolves.toBeDefined();
  await readyPerson(db, f, "Second Synthetic Worker");
  await expect(updatePersonnelLimit(db, f.adminActor, { registrationId: f.registration.id, expectedVersion: 4, personnelLimit: 1 })).rejects.toMatchObject({ code: "PERSONNEL_LIMIT_REACHED" });
  await updateEvent(db, f.adminActor, { id: f.event.id, expectedVersion: 1, name: f.event.name, startDate: "2026-10-01", endDate: "2036-01-01", onboardingOpensAt: f.event.onboardingOpensAt.toISOString(), onboardingClosesAt: f.event.onboardingClosesAt.toISOString(), publicationState: "PUBLISHED" });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("RETURNED_FOR_CORRECTION");
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: f.person.id } })).status).toBe("AWAITING_LEADER_REVIEW");
  await expect(approveParticipant(db, f.leaderActor, f.person.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const another = await submitted(true);
  const role = await db.jobRole.findUniqueOrThrow({ where: { id: another.person.jobRoleId! } });
  await jobRoles.update(db, another.adminActor, { id: role.id, expectedVersion: role.version, name: role.name, active: false });
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: another.registration.id } })).status).toBe("RETURNED_FOR_CORRECTION");
  await expect(approveParticipant(db, another.leaderActor, another.person.id)).rejects.toMatchObject({ code: "SUBMISSION_INCOMPLETE" });
});

it("F02 preserves original and adjusted history across legitimate correction uploads and reopening", async () => {
  const f = await submitted();
  const upload = await prepareSubmissionPhotoUpload(db, f.adminActor, f.submission.id, f.person.id, "aia-phase1-synthetic");
  await recordSubmissionPhotoAdjustment(db, f.adminActor, { submissionId: f.submission.id, participantId: f.person.id, photoObjectKey: upload.objectKey });
  expect(await adminSubmissionPhotoAccess(db, f.adminActor, f.submission.id, f.person.id, keys.encryptionKey, true)).toBe(f.person.photoObjectKey);
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: f.submission.id, participantId: f.person.id, outcome: "RETURNED_FOR_CORRECTION", reason: "PHOTO", comment: "Synthetic correction" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: f.submission.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "PHOTO", comment: "Synthetic correction" });
  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() - 1000) } });
  const nextPhoto = await prepareLeaderPhotoUpload(db, f.leaderActor, f.person.id, "aia-phase1-synthetic");
  await updateParticipantByLeader(db, f.leaderActor, f.person.id, {...input(f.person.jobRoleId!),fullName:f.person.fullName!,documentNumber:undefined}, keys, nextPhoto.objectKey);
  await approveParticipant(db, f.leaderActor, f.person.id);
  const next = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3, ...declaration }, keys.encryptionKey);
  expect(await adminSubmissionPhotoAccess(db, f.adminActor, f.submission.id, f.person.id, keys.encryptionKey)).toBe(upload.objectKey);
  expect(await adminSubmissionPhotoAccess(db, f.adminActor, next.id, f.person.id, keys.encryptionKey)).toBe(nextPhoto.objectKey);
  await expect(prepareLeaderPhotoUpload(db, f.leaderActor, f.person.id, "aia-phase1-synthetic")).rejects.toThrow();
});

it("F02 immutable storage, stale adoption and durable cleanup preserve accepted bytes under failures", async () => {
  const env = parseStorageEnv(process.env);
  if (!["127.0.0.1", "localhost"].includes(new URL(env.MINIO_ENDPOINT).hostname) || env.MINIO_PHOTOS_BUCKET !== "aia-phase1-synthetic") throw new Error("SYNTHETIC_STORAGE_REQUIRED");
  const storage = createObjectStorage({ endpoint: env.MINIO_ENDPOINT, accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY, bucket: env.MINIO_PHOTOS_BUCKET, region: env.MINIO_REGION });
  await storage.ensureBucket();
  const f = await fixture(db), person = await createParticipant(db, f.leaderActor, f.registration.id);
  const role = await db.jobRole.create({ data: { name: `Synthetic ${randomUUID()}` } });
  const [first, second] = await Promise.all([prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET), prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET)]);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const bytes = await processParticipantPhoto(png, "image/png");
  await storage.putPhoto(first.objectKey, bytes); await storage.putPhoto(second.objectKey, bytes);
  await expect(storage.putPhoto(first.objectKey, Buffer.from("replacement"))).rejects.toThrow();
  await updateParticipantByLeader(db, f.leaderActor, person.id, input(role.id), keys, first.objectKey);
  await expect(updateParticipantByLeader(db, f.leaderActor, person.id, input(role.id), keys, second.objectKey)).rejects.toMatchObject({ code: "STALE_WRITE" });
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: person.id } })).photoObjectKey).toBe(first.objectKey);
  expect(await storage.getPhoto(first.objectKey)).toEqual(new Uint8Array(bytes));
  await abandonPhotoUpload(db, first.objectKey); // lost commit acknowledgement must not erase the winner
  expect((await db.photoUpload.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("ADOPTED");
  // Scope the cleanup fixture ahead of old rejected synthetic objects without deleting them.
  await db.photoUpload.update({ where: { id: second.id }, data: { expiresAt: new Date("2000-01-01") } });
  expect(await cleanupNextPhotoUpload(db, async () => { throw new Error("synthetic storage outage"); })).toBe("RETRY");
  expect((await db.photoUpload.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("CLEANING");
  await db.photoUpload.update({ where: { id: second.id }, data: { expiresAt: new Date("2000-01-01") } });
  expect(await cleanupNextPhotoUpload(db, (bucket, key) => { expect(bucket).toBe(env.MINIO_PHOTOS_BUCKET); return storage.deletePhoto(key); })).toBe("CLEANED");
  await expect(storage.getPhoto(second.objectKey)).rejects.toThrow();
  expect(await storage.getPhoto(first.objectKey)).toEqual(new Uint8Array(bytes));
  const rejected = await prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET);
  await storage.putPhoto(rejected.objectKey, bytes);
  await expect(updateParticipantByLeader(db, f.leaderActor, person.id, { ...input(role.id), workDays: ["2026-11-01"] }, keys, rejected.objectKey)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect((await db.photoUpload.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe("STAGED");
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: person.id } })).photoObjectKey).toBe(first.objectKey);
  const failedStorage = await prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET);
  const before = await db.eventParticipant.findUniqueOrThrow({ where: { id: person.id } });
  await expect(createObjectStorage({ endpoint: "http://127.0.0.1:1", accessKey: env.MINIO_ACCESS_KEY, secretKey: env.MINIO_SECRET_KEY, bucket: env.MINIO_PHOTOS_BUCKET, region: env.MINIO_REGION }).putPhoto(failedStorage.objectKey, bytes)).rejects.toThrow();
  await abandonPhotoUpload(db, failedStorage.objectKey);
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id: person.id } })).toEqual(before);
  await approveParticipant(db, f.leaderActor, person.id);
  await readyConfiguration(db, f);
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...declaration }, keys.encryptionKey);
  await reviewSubmissionParticipant(db, f.adminActor, { submissionId: submission.id, participantId: person.id, outcome: "APPROVED" });
  await reviewCompanySubmission(db, f.adminActor, { submissionId: submission.id, expectedRegistrationVersion: 2, action: "APPROVE" });
  await expect(prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET)).rejects.toMatchObject({ code: "EDIT_LOCKED" });
  expect(await storage.getPhoto(first.objectKey)).toEqual(new Uint8Array(bytes));
  await reopenApprovedRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3 });
  expect((await prepareLeaderPhotoUpload(db, f.leaderActor, person.id, env.MINIO_PHOTOS_BUCKET)).objectKey).not.toBe(first.objectKey);
});
