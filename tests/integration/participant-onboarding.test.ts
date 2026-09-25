import { createHash, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  adminDuplicateReview,
  approveParticipant,
  createParticipant,
  createParticipantWithInvitation,
  employeeInvitationView,
  issueEmployeeInvitation,
  leaderParticipant,
  leaderRegistration,
  overrideDuplicate,
  removeParticipant,
  revokeEmployeeInvitation,
  submitEmployeeOnboarding,
  updateParticipantByLeader,
  updatePersonnelLimit,
} from "../../packages/domain/src/index.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";

afterAll(() => db.$disconnect());

const keys = { encryptionKey: "11".repeat(32), fingerprintKey: "22".repeat(32) };
const expiresSoon = () => new Date(Date.now() + 60 * 60 * 1000);

async function role() {
  return db.jobRole.create({ data: { name: `Synthetic role ${randomUUID()}` } });
}

function employeeDetails(jobRoleId: string, documentNumber = "AA-12 34", documentExpiryDate = "2026-10-03") {
  return {
    fullName: "Synthetic Employee",
    dateOfBirth: "1990-01-02",
    documentType: "PASSPORT" as const,
    documentNumber,
    documentExpiryDate,
    mobile: "+351 912 345 678",
    nationalityCode: "pt",
    jobRoleId,
    workDays: ["2026-10-01", "2026-10-03"],
    privacyAcknowledged: true as const,
    privacyNoticeVersion: "TEST-NOTICE-v1",
  };
}

async function participantWithToken(f: Awaited<ReturnType<typeof fixture>>) {
  const participant = await createParticipant(db, f.leaderActor, f.registration.id);
  const invitation = await issueEmployeeInvitation(db, f.leaderActor, participant.id, expiresSoon());
  return { participant, invitation };
}

it("enforces personnel capacity inside participant creation", async () => {
  const f = await fixture(db);
  for (let index = 0; index < 10; index += 1) await createParticipant(db, f.leaderActor, f.registration.id);
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).rejects.toThrow("PERSONNEL_LIMIT_REACHED");
  expect(await db.eventParticipant.count({ where: { registrationId: f.registration.id } })).toBe(10);
  await updatePersonnelLimit(db, f.adminActor, { registrationId: f.registration.id, expectedVersion: 1, personnelLimit: 11 });
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).resolves.toMatchObject({ registrationId: f.registration.id });
});

it("creates a worker slot and hashed one-time invitation atomically", async () => {
  const f = await fixture(db);
  const requestedExpiry = new Date(f.event.onboardingClosesAt.getTime() + 86_400_000);
  const result = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, requestedExpiry);

  const participant = await db.eventParticipant.findUniqueOrThrow({ where: { id: result.participantId } });
  const invitation = await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: result.invitationId } });
  expect(participant.status).toBe("AWAITING_EMPLOYEE");
  expect(invitation.participantId).toBe(participant.id);
  expect(invitation.tokenHash).toBe(createHash("sha256").update(result.token).digest("hex"));
  expect(invitation.tokenHash).not.toContain(result.token);
  expect(invitation.expiresAt).toEqual(f.event.onboardingClosesAt);

  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { personnelLimit: 1 } });
  const participantCount = await db.eventParticipant.count({ where: { registrationId: f.registration.id } });
  const invitationCount = await db.employeeInvitationToken.count({ where: { participant: { registrationId: f.registration.id } } });
  await expect(createParticipantWithInvitation(db, f.leaderActor, f.registration.id, expiresSoon())).rejects.toThrow("PERSONNEL_LIMIT_REACHED");
  expect(await db.eventParticipant.count({ where: { registrationId: f.registration.id } })).toBe(participantCount);
  expect(await db.employeeInvitationToken.count({ where: { participant: { registrationId: f.registration.id } } })).toBe(invitationCount);
});

it("removes a worker without deleting history and releases the personnel place", async () => {
  const f = await fixture(db);
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { personnelLimit: 1 } });
  const created = await createParticipantWithInvitation(db, f.leaderActor, f.registration.id, expiresSoon());
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).rejects.toThrow("PERSONNEL_LIMIT_REACHED");

  await removeParticipant(db, f.leaderActor, created.participantId);
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: created.participantId } })).status).toBe("REMOVED");
  expect((await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: created.invitationId } })).revokedAt).not.toBeNull();
  await expect(createParticipant(db, f.leaderActor, f.registration.id)).resolves.toMatchObject({ registrationId: f.registration.id });
  await expect(db.auditEvent.findFirstOrThrow({ where: { entityId: created.participantId, action: "PARTICIPANT_REMOVED" } })).resolves.toBeTruthy();
});

it("bounds one-time employee links by revocation, expiry, onboarding close, and successful use", async () => {
  const f = await fixture(db);
  const first = await participantWithToken(f);
  expect((await employeeInvitationView(db, first.invitation.token)).participantId).toBe(first.participant.id);
  await revokeEmployeeInvitation(db, f.leaderActor, first.invitation.invitationId);
  await expect(employeeInvitationView(db, first.invitation.token)).rejects.toThrow("TOKEN_UNAVAILABLE");

  const secondParticipant = await createParticipant(db, f.leaderActor, f.registration.id);
  const expired = await issueEmployeeInvitation(db, f.leaderActor, secondParticipant.id, expiresSoon());
  await db.employeeInvitationToken.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await expect(employeeInvitationView(db, expired.token)).rejects.toThrow("TOKEN_UNAVAILABLE");

  const third = await participantWithToken(f);
  await db.event.update({ where: { id: f.event.id }, data: { onboardingOpensAt: new Date(Date.now() + 60_000) } });
  await expect(employeeInvitationView(db, third.invitation.token)).rejects.toThrow("TOKEN_UNAVAILABLE");
  await db.event.update({ where: { id: f.event.id }, data: { onboardingOpensAt: new Date(Date.now() - 86400000) } });

  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() - 1000) } });
  await expect(employeeInvitationView(db, third.invitation.token)).rejects.toThrow("TOKEN_UNAVAILABLE");

  await db.event.update({ where: { id: f.event.id }, data: { onboardingClosesAt: new Date(Date.now() + 86400000) } });
  const fourth = await participantWithToken(f);
  const jobRole = await role();
  await submitEmployeeOnboarding(db, fourth.invitation.token, employeeDetails(jobRole.id), keys, "photos/test/profile.jpg");
  await expect(employeeInvitationView(db, fourth.invitation.token)).rejects.toThrow("TOKEN_UNAVAILABLE");
  expect((await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: fourth.invitation.invitationId } })).usedAt).not.toBeNull();
});

it("requires document validity through the event end and complete employee evidence before approval", async () => {
  const f = await fixture(db);
  const jobRole = await role();
  const early = await participantWithToken(f);
  await expect(submitEmployeeOnboarding(db, early.invitation.token, employeeDetails(jobRole.id, "EARLY-1", "2026-10-02"), keys, "photos/test/early.jpg")).rejects.toThrow("INVALID_INPUT");
  expect((await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: early.invitation.invitationId } })).usedAt).toBeNull();

  const exact = await participantWithToken(f);
  await submitEmployeeOnboarding(db, exact.invitation.token, employeeDetails(jobRole.id, "EXACT-1", "2026-10-03"), keys, "photos/test/exact.jpg");
  await approveParticipant(db, f.leaderActor, exact.participant.id);
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: exact.participant.id } })).status).toBe("LEADER_APPROVED");

  const incomplete = await createParticipant(db, f.leaderActor, f.registration.id);
  await expect(approveParticipant(db, f.leaderActor, incomplete.id)).rejects.toThrow("INVALID_INPUT");
});

it("allows direct leader entry only after recording the person's privacy acknowledgement", async () => {
  const f = await fixture(db);
  const jobRole = await role();
  const participant = await createParticipant(db, f.leaderActor, f.registration.id);
  const input = { ...employeeDetails(jobRole.id, "DIRECT-1"), privacyAcknowledged: true, privacyNoticeVersion: "TEST-NOTICE-v1" };
  await updateParticipantByLeader(db, f.leaderActor, participant.id, input, keys, "photos/test/direct.jpg");
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: participant.id } })).status).toBe("AWAITING_LEADER_REVIEW");
  await approveParticipant(db, f.leaderActor, participant.id);
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: participant.id } })).status).toBe("LEADER_APPROVED");
});

it("detects formatted duplicates across companies, isolates leaders, and records an admin override without PII", async () => {
  const f = await fixture(db);
  const jobRole = await role();
  const first = await participantWithToken(f);
  await submitEmployeeOnboarding(db, first.invitation.token, employeeDetails(jobRole.id, "PT-12 34"), keys, "photos/test/first.jpg");

  const otherLeader = await db.user.create({ data: { clerkUserId: `other-leader-${randomUUID()}`, role: "COMPANY_LEADER" } });
  const otherCompany = await db.company.create({ data: { name: `Other synthetic company ${randomUUID()}` } });
  const otherMembership = await db.companyLeaderMembership.create({ data: { companyId: otherCompany.id, userId: otherLeader.id } });
  const otherRegistration = await db.companyEventRegistration.create({ data: { eventId: f.event.id, companyId: otherCompany.id, primaryLeaderMembershipId: otherMembership.id } });
  const otherActor = { clerkUserId: otherLeader.clerkUserId, correlationId: randomUUID() };
  const duplicate = await createParticipant(db, otherActor, otherRegistration.id);
  const duplicateInvitation = await issueEmployeeInvitation(db, otherActor, duplicate.id, expiresSoon());
  const result = await submitEmployeeOnboarding(db, duplicateInvitation.token, employeeDetails(jobRole.id, "pt.1234"), keys, "photos/test/duplicate.jpg");
  expect(result.duplicate).toBe(true);

  await expect(leaderParticipant(db, f.leaderActor, duplicate.id, keys.encryptionKey)).rejects.toThrow("FORBIDDEN");
  const leaderView = await leaderRegistration(db, otherActor, otherRegistration.id, keys.encryptionKey);
  expect(leaderView.participants[0]?.documentNumber).toBe("pt.1234");
  expect(JSON.stringify(leaderView)).not.toContain(f.company.name);
  expect(JSON.stringify(leaderView)).not.toContain("documentNumberFingerprint");
  expect(JSON.stringify(leaderView)).not.toContain("documentNumberCiphertext");
  expect(JSON.stringify(leaderView)).not.toContain("documentNumberLast3");

  const adminView = await adminDuplicateReview(db, f.adminActor);
  const review = adminView.find(item => item.id === duplicate.id);
  expect(review?.conflicts[0]?.registration.company.name).toBe(f.company.name);
  await overrideDuplicate(db, f.adminActor, duplicate.id);
  const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: duplicate.id, action: "DUPLICATE_OVERRIDDEN" }, orderBy: { occurredAt: "desc" } });
  expect(audit.metadata).toEqual({ override: true, reasonCategory: "DUPLICATE" });
  expect(JSON.stringify(audit)).not.toContain("PT-12 34");
});
