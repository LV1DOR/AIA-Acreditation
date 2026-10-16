import { readyPerson, syntheticPhoto } from "../fixtures/security.ts";
import { prepareSubmissionPhotoUpload } from "../../packages/domain/src/index.ts";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { adminSubmissionPhotoAccess, configureRegistration, createParticipant, decryptSubmissionSnapshot, leaderParticipant, recordSubmissionPhotoAdjustment, removeParticipant, reopenApprovedRegistration, reviewCompanySubmission, reviewSubmissionParticipant, submitCompanyRegistration, updateParticipantByLeader } from "../../packages/domain/src/index.ts";

afterAll(() => db.$disconnect());
const snapshotKey = "a".repeat(64);
const submissionConsent = { dataProcessingAccepted: true as const, dataProcessingNoticeVersion: "test-v1" };

async function readyRegistration() {
  const f = await fixture(db);
  const zone = await db.zone.create({ data: { name: `Zone ${f.registration.id}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: false } });
  await readyPerson(db, f);
  return f;
}

it("creates immutable, versioned snapshots and locks the mutable workspace", async () => {
  const f = await readyRegistration();
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey);
  expect(submission.version).toBe(1);
  expect(submission.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("AIA_REVIEW");
  await db.company.update({ where: { id: f.company.id }, data: { name: "Changed after submission" } });
  const stored = await db.companySubmission.findUniqueOrThrow({ where: { id: submission.id } });
  expect(JSON.stringify(stored.snapshot)).not.toContain(f.company.name);
  const snapshot = decryptSubmissionSnapshot(stored.snapshot, snapshotKey, stored.id) as { company: { name: string }; dataProcessingDeclaration: { noticeVersion: string; submittedByUserId: string } };
  expect(snapshot.company.name).toBe(f.company.name);
  expect(snapshot.dataProcessingDeclaration).toMatchObject({ noticeVersion: "test-v1", submittedByUserId: f.leader.id });
  await expect(db.companySubmission.update({ where: { id: stored.id }, data: { contentHash: "0".repeat(64) } })).rejects.toThrow();
  await expect(submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 2, ...submissionConsent }, snapshotKey)).rejects.toMatchObject({ code: "EDIT_LOCKED" });
  expect(await db.auditEvent.count({ where: { entityId: submission.id, action: "SUBMISSION_CREATED" } })).toBe(1);
});

it("rejects a final submission without the required data-processing declaration", async () => {
  const f = await readyRegistration();
  await expect(submitCompanyRegistration(db, f.leaderActor, {
    registrationId: f.registration.id, expectedVersion: 1, dataProcessingAccepted: false as true, dataProcessingNoticeVersion: "test-v1",
  }, snapshotKey)).rejects.toThrow();
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(0);
});

it("returns only selected people for correction and leaves approved people locked", async () => {
  const f=await readyRegistration();
  const first=await db.eventParticipant.findFirstOrThrow({where:{registrationId:f.registration.id}});
  const second=await readyPerson(db, f, "Approved Person");
  const submission=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,...submissionConsent},snapshotKey);
  await reviewSubmissionParticipant(db,f.adminActor,{submissionId:submission.id,participantId:first.id,outcome:"RETURNED_FOR_CORRECTION",reason:"PHOTO",comment:"The photo needs slightly less zoom."});
  await reviewSubmissionParticipant(db,f.adminActor,{submissionId:submission.id,participantId:second.id,outcome:"APPROVED"});
  await reviewCompanySubmission(db,f.adminActor,{submissionId:submission.id,expectedRegistrationVersion:2,action:"RETURN",reason:"PERSONNEL",comment:"One person requires correction."});
  const people=await db.eventParticipant.findMany({where:{id:{in:[first.id,second.id]}},orderBy:{fullName:"asc"}});
  expect(people.find(person=>person.id===first.id)?.status).toBe("AWAITING_LEADER_REVIEW");
  expect(people.find(person=>person.id===second.id)?.status).toBe("LEADER_APPROVED");
  const returnedView=await leaderParticipant(db,f.leaderActor,first.id,"1".repeat(64));
  expect(returnedView.correction).toMatchObject({reasonCategory:"PHOTO",comment:"The photo needs slightly less zoom."});
  const role=await db.jobRole.create({data:{name:`Technician ${f.registration.id}`}});
  await expect(updateParticipantByLeader(db,f.leaderActor,first.id,{
    fullName:"Ready Person",dateOfBirth:"1990-01-01",documentType:"PASSPORT",documentNumber:"P67890",documentExpiryDate:"2030-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:role.id,workDays:["2026-10-01"],privacyAcknowledged:true,privacyNoticeVersion:"test",
  },{encryptionKey:"1".repeat(64),fingerprintKey:"2".repeat(64)})).rejects.toMatchObject({code:"EDIT_LOCKED"});
  await expect(updateParticipantByLeader(db,f.leaderActor,first.id,{
    fullName:first.fullName!,dateOfBirth:"1990-01-01",documentType:"PASSPORT",documentExpiryDate:"2035-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:first.jobRoleId!,workDays:["2026-10-01"],
  },{encryptionKey:"1".repeat(64),fingerprintKey:"2".repeat(64)},await syntheticPhoto(db,first.id))).resolves.toEqual({duplicate:false});
  expect((await db.eventParticipant.findUniqueOrThrow({where:{id:first.id}})).fullName).toBe(first.fullName);
  await expect(createParticipant(db,f.leaderActor,f.registration.id)).rejects.toMatchObject({code:"EDIT_LOCKED"});
  const selectedZone=await db.companyZoneRequest.findFirstOrThrow({where:{registrationId:f.registration.id}});
  await expect(configureRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:3,zoneIds:[selectedZone.zoneId],vehicle:{required:false,requestedQuantity:0,justification:null}})).rejects.toMatchObject({code:"EDIT_LOCKED"});
  await expect(updateParticipantByLeader(db,f.leaderActor,second.id,{
    fullName:"Approved Person",dateOfBirth:"1990-01-01",documentType:"PASSPORT",documentNumber:"P12345",documentExpiryDate:"2030-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:role.id,workDays:["2026-10-01"],privacyAcknowledged:true,privacyNoticeVersion:"test",
  },{encryptionKey:"1".repeat(64),fingerprintKey:"2".repeat(64)})).rejects.toMatchObject({code:"EDIT_LOCKED"});
  await expect(removeParticipant(db,f.leaderActor,second.id)).rejects.toMatchObject({code:"EDIT_LOCKED"});
  expect(await db.auditEvent.count({where:{entityType:"SubmissionParticipantReview",action:{in:["SUBMISSION_PARTICIPANT_APPROVED","SUBMISSION_PARTICIPANT_RETURNED"]}}})).toBeGreaterThanOrEqual(2);
});

it("requires reasons for corrective decisions and creates a new version after resubmission", async () => {
  const f = await readyRegistration();
  const first = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey);
  await expect(reviewCompanySubmission(db, f.adminActor, { submissionId: first.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "OTHER", comment: "" })).rejects.toThrow();
  await reviewCompanySubmission(db, f.adminActor, { submissionId: first.id, expectedRegistrationVersion: 2, action: "RETURN", reason: "DOCUMENT", comment: "Confirm the document." });
  const second = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 3, ...submissionConsent }, snapshotKey);
  expect(second.version).toBe(2);
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(2);
  const review = await db.companySubmissionReview.findFirstOrThrow({ where: { submissionId: first.id } });
  expect(review.outcome).toBe("RETURNED_FOR_CORRECTION");
  await expect(db.companySubmissionReview.update({ where: { id: review.id }, data: { comment: "Changed" } })).rejects.toThrow();
});

it("allows one review decision and invalidates approval only when reopening before deadline", async () => {
  const f = await readyRegistration();
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey);
  const participant=await db.eventParticipant.findFirstOrThrow({where:{registrationId:f.registration.id,status:"LEADER_APPROVED"}});
  await reviewSubmissionParticipant(db,f.adminActor,{submissionId:submission.id,participantId:participant.id,outcome:"APPROVED"});
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
    submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey),
    submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey),
  ]);
  expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
  expect(await db.companySubmission.count({ where: { registrationId: f.registration.id } })).toBe(1);
});

it("stores AIA photo framing as an immutable submission-scoped derivative", async () => {
  const f = await readyRegistration();
  const participant = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: f.registration.id } });
  const submission = await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, ...submissionConsent }, snapshotKey);
  const key = (await prepareSubmissionPhotoUpload(db, f.adminActor, submission.id, participant.id, "aia-phase1-synthetic")).objectKey;
  const adjustment = await recordSubmissionPhotoAdjustment(db, f.adminActor, { submissionId: submission.id, participantId: participant.id, photoObjectKey: key });
  expect(await adminSubmissionPhotoAccess(db, f.adminActor, submission.id, participant.id, snapshotKey)).toBe(key);
  await expect(adminSubmissionPhotoAccess(db, f.leaderActor, submission.id, participant.id, snapshotKey)).rejects.toThrow("FORBIDDEN");
  await expect(db.submissionPhotoAdjustment.update({ where: { id: adjustment.id }, data: { photoObjectKey: "changed" } })).rejects.toThrow();
  expect(await db.auditEvent.count({ where: { entityId: adjustment.id, action: "SUBMISSION_PHOTO_ADJUSTED" } })).toBe(1);
});
