import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { weBookAttendees } from "../../packages/domain/src/exports/webook.ts";
import { idAllAttendees } from "../../packages/domain/src/exports/id-all.ts";
import { encryptSubmissionSnapshot } from "../../packages/domain/src/submissions/snapshot-crypto.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";

afterAll(() => db.$disconnect());
const key = "a".repeat(64);

async function approvedEvent(internal = false) {
  const f = await fixture(db);
  const person = await db.eventParticipant.create({ data: { eventId: f.event.id, registrationId: f.registration.id, status: "LEADER_APPROVED", fullName: "Changed workspace name", photoObjectKey: "photos/workspace.jpg" } });
  const second = await db.eventParticipant.create({ data: { eventId: f.event.id, registrationId: f.registration.id, status: "LEADER_APPROVED", fullName: "Second workspace name" } });
  const zone = await db.zone.create({ data: { name: `Export zone ${randomUUID()}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  const submissionId = randomUUID();
  const snapshot = {
    company: { name: "Approved Synthetic Company", internalOrganisation: internal ? "AIA" : null }, zones: internal ? [] : [{ id: zone.id }],
    participants: [person, second].map((p, i) => ({ id: p.id, version: p.version, fullName: i ? "Zeta Synthetic" : "Álvaro Synthetic", jobRole: { name: "Operações" }, photoObjectKey: `photos/approved-${p.id}.jpg`, zones: internal ? [{ id: zone.id }] : [] })),
  };
  const submission = await db.companySubmission.create({ data: { id: submissionId, registrationId: f.registration.id, version: 1, registrationVersion: 1, submittedByUserId: f.leader.id, contentHash: "f".repeat(64), snapshot: encryptSubmissionSnapshot(JSON.stringify(snapshot), key, submissionId) } });
  await db.companySubmissionReview.create({ data: { submissionId, outcome: "APPROVED", reviewedByUserId: f.admin.id } });
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "APPROVED" } });
  await db.submissionPhotoAdjustment.create({ data: { submissionId, participantId: person.id, photoObjectKey: "photos/review-adjusted.jpg", adjustedByUserId: f.admin.id } });
  return { ...f, person, second, submission, zone };
}

it("exports everyone again using approved names, roles and adjusted photos without writing export state", async () => {
  const f = await approvedEvent();
  await db.eventParticipant.create({ data: { eventId: f.event.id, registrationId: f.registration.id, status: "DRAFT", fullName: "Draft excluded" } });
  const before = await db.eventParticipant.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } });
  const auditBefore = await db.auditEvent.count({ where: { eventId: f.event.id } });
  const first = await idAllAttendees(db, f.adminActor, f.event.id, key);
  expect(first).toEqual([
    { id: f.person.id, fullName: "Álvaro Synthetic", role: "Operações", photoObjectKey: "photos/review-adjusted.jpg", companyName: "Approved Synthetic Company" },
    { id: f.second.id, fullName: "Zeta Synthetic", role: "Operações", photoObjectKey: `photos/approved-${f.second.id}.jpg`, companyName: "Approved Synthetic Company" },
  ]);
  expect(await idAllAttendees(db, f.adminActor, f.event.id, key)).toEqual(first);
  expect(await db.eventParticipant.findMany({ where: { eventId: f.event.id }, orderBy: { id: "asc" } })).toEqual(before);
  expect(await db.auditEvent.count({ where: { eventId: f.event.id } })).toBe(auditBefore);
});

it.each([false, true])("exports the approved company name even after a workspace rename (internal=%s)", async internal => {
  const f = await approvedEvent(internal);
  await db.company.update({ where: { id: f.company.id }, data: { name: "Unapproved workspace rename" } });
  const attendees = await idAllAttendees(db, f.adminActor, f.event.id, key);
  expect(attendees).toHaveLength(2);
  expect(attendees.map(person => person.companyName)).toEqual(["Approved Synthetic Company", "Approved Synthetic Company"]);
});

it("requires an active admin and the requested event, with no fallback to another event", async () => {
  const f = await approvedEvent(), other = await fixture(db);
  await expect(idAllAttendees(db, f.leaderActor, f.event.id, key)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(idAllAttendees(db, f.adminActor, randomUUID(), key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(idAllAttendees(db, f.adminActor, other.event.id, key)).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
  await expect(idAllAttendees(db, f.adminActor, "not-an-event", key)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await db.user.update({ where: { id: f.admin.id }, data: { disabledAt: new Date() } });
  await expect(idAllAttendees(db, f.adminActor, f.event.id, key)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("excludes removed, erased and stale participant versions, and invalidated approval", async () => {
  const f = await approvedEvent();
  await db.eventParticipant.update({ where: { id: f.person.id }, data: { status: "REMOVED" } });
  expect((await idAllAttendees(db, f.adminActor, f.event.id, key)).map(p => p.id)).toEqual([f.second.id]);
  await db.eventParticipant.update({ where: { id: f.second.id }, data: { version: { increment: 1 } } });
  await expect(idAllAttendees(db, f.adminActor, f.event.id, key)).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
  const other = await approvedEvent();
  await db.eventParticipant.update({ where: { id: other.person.id }, data: { erasedAt: new Date() } });
  expect((await idAllAttendees(db, other.adminActor, other.event.id, key)).map(p => p.id)).toEqual([other.second.id]);
  await db.companySubmissionReview.create({ data: { submissionId: other.submission.id, outcome: "APPROVAL_INVALIDATED", reviewedByUserId: other.admin.id, createdAt: new Date(Date.now() + 1000) } });
  await expect(idAllAttendees(db, other.adminActor, other.event.id, key)).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
});

it.each([false, true])("honours effective company/individual zones (internal=%s)", async internal => {
  const f = await approvedEvent(internal);
  expect(await idAllAttendees(db, f.adminActor, f.event.id, key)).toHaveLength(2);
  await db.eventZone.update({ where: { eventId_zoneId: { eventId: f.event.id, zoneId: f.zone.id } }, data: { deactivatedAt: new Date() } });
  await expect(idAllAttendees(db, f.adminActor, f.event.id, key)).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
});


it("WeBook uses approved names and configured zones, excludes removed people, and denies leaders", async () => {
  const f = await approvedEvent();
  await expect(weBookAttendees(db, f.leaderActor, f.event.id, key)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const first = await weBookAttendees(db, f.adminActor, f.event.id, key);
  expect(first.map(p => p.fullName)).toEqual(["Álvaro Synthetic", "Zeta Synthetic"]);
  expect(first[0]!.zones).toEqual([f.zone.name]);
  await db.eventParticipant.update({ where: { id: f.person.id }, data: { status: "REMOVED" } });
  expect((await weBookAttendees(db, f.adminActor, f.event.id, key)).map(p => p.id)).toEqual([f.second.id]);
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "REJECTED", withdrawnAt: new Date() } });
  await expect(weBookAttendees(db, f.adminActor, f.event.id, key)).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
});
