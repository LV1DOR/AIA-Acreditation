import { createHash, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { validateParticipantEligibility } from "../../packages/domain/src/submissions/eligibility.ts";
import { saveParticipantDraft, updateParticipantByLeader } from "../../packages/domain/src/participants/service.ts";

vi.mock("../../packages/config/src/index.ts", () => ({ syntheticMode: () => false, deploymentMode: () => "production" }));
vi.mock("../../packages/domain/src/shared/transaction.ts", () => ({ transaction: async (db: unknown, work: (tx: unknown) => unknown) => work(db) }));
vi.mock("../../packages/domain/src/submissions/capabilities.ts", () => ({
  participantCapabilities: async () => ({ editable: true, canSaveDraft: true, fields: ["IDENTITY", "CONTACT", "ROLE", "WORK_DAYS", "PHOTO", "PRIVACY"] }),
  registrationCapabilities: async () => ({ add: true }),
}));

vi.mock("../../packages/domain/src/submissions/eligibility.ts", () => ({ validateParticipantEligibility: vi.fn(async () => {}) }));

const ids = { person: randomUUID(), registration: randomUUID(), company: randomUUID(), event: randomUUID(), role: randomUUID(), user: randomUUID() };
const context = { clerkUserId: "synthetic-leader", correlationId: randomUUID() };
const keys = { encryptionKey: "01".repeat(32), fingerprintKey: "02".repeat(32) };
const text = "Approved synthetic fixture notice for Synthetic event.";
const noticeHash = createHash("sha256").update(text).digest("hex");
const data = {
  fullName: "Synthetic worker", dateOfBirth: "1990-01-01", documentType: "PASSPORT" as const,
  documentNumber: "SYNTHETIC123", documentExpiryDate: "2035-01-01", mobile: "+351912345678",
  nationalityCode: "PT", jobRoleId: ids.role, workDays: ["2030-01-01"],
  privacyAcknowledged: true, privacyNoticeVersion: "approved-v1", privacyNoticeHash: noticeHash, noticeLocale: "en" as const,
};

function client(role: "COMPANY_LEADER" | "ADMIN" = "COMPANY_LEADER") {
  const registration = { id: ids.registration, companyId: ids.company, eventId: ids.event, erasedAt: null,
    event: { startDate: new Date("2030-01-01"), endDate: new Date("2030-01-02") } };
  const participant = { id: ids.person, registrationId: ids.registration, eventId: ids.event, registration,
    fullName: data.fullName, dateOfBirth: new Date(data.dateOfBirth), documentExpiryDate: new Date(data.documentExpiryDate),
    documentType: data.documentType, mobileE164: data.mobile, nationalityCode: data.nationalityCode, jobRoleId: ids.role,
    internalReference: null as string | null, workDays: [{ workDate: new Date(data.workDays[0]!) }],
    version: 1, status: "DRAFT", photoObjectKey: "synthetic/existing-photo", privacyAcknowledgedAt: null,
    documentNumberFingerprint: null };
  return {
    user: { findUnique: vi.fn(async () => ({ id: ids.user, role, disabledAt: null })) },
    company: { findUnique: vi.fn(async () => ({ id: ids.company, deactivatedAt: null, internalOrganisation: null })) },
    companyLeaderMembership: { findUnique: vi.fn(async () => ({ revokedAt: null })) },
    eventParticipant: { findUnique: vi.fn(async () => participant), findUniqueOrThrow: vi.fn(async () => participant),
      count: vi.fn(async () => 0), update: vi.fn(async ({ data: changes }: { data: Record<string, unknown> }) => Object.assign(participant, changes)) },
    companyEventRegistration: { findUniqueOrThrow: vi.fn(async () => registration) },
    event: { findUniqueOrThrow: vi.fn(async () => ({ name: "Synthetic event" })) },
    privacyErasureJob: { count: vi.fn(async () => 0) },
    privacyNotice: { findFirst: vi.fn(async () => ({ id: randomUUID(), version: "approved-v1", textPt: text, textEn: text, synthetic: false })) },
    eventRetentionPolicy: { findFirst: vi.fn(async () => ({ id: randomUUID() })) },
    privacyAcknowledgement: { create: vi.fn(async () => ({})) },
    employeeInvitationToken: { updateMany: vi.fn(async () => ({ count: 0 })) },
    participantWorkDay: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 1 })) },
    jobRole: { findFirst: vi.fn(async () => ({ id: ids.role })) }, auditEvent: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => [{ unsafe: false }]),
  };
}

beforeEach(() => vi.clearAllMocks());

for (const role of ["COMPANY_LEADER", "ADMIN"] as const) {
  it(`saves a worker with the genuinely presented notice hash as ${role} in production mode`, async () => {
    const mock = client(role);
    await updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person, data, keys, undefined, 1);
    expect(mock.privacyAcknowledgement.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorType: role, noticeVersion: data.privacyNoticeVersion, noticeHash, presentedText: text, locale: "en",
    }) });
    expect(mock.eventParticipant.update).toHaveBeenCalledTimes(1);
  });
}

it("preserves notice evidence when saving a draft and returning to the worker list", async () => {
  const mock = client();
  await saveParticipantDraft(mock as unknown as PrismaClient, context, ids.person, data, keys);
  expect(mock.privacyAcknowledgement.create).toHaveBeenCalledWith({ data: expect.objectContaining({ noticeHash, presentedText: text }) });
  expect(mock.eventParticipant.update).toHaveBeenCalledTimes(1);
});

for (const hash of [undefined, "0".repeat(64)]) {
  it(`still rejects ${hash ? "forged" : "missing"} notice hashes before changing worker data`, async () => {
    const mock = client();
    await expect(updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person,
      { ...data, privacyNoticeHash: hash }, keys, undefined, 1)).rejects.toThrow("PRIVACY_NOTICE_CHANGED");
    expect(mock.privacyAcknowledgement.create).not.toHaveBeenCalled();
    expect(mock.eventParticipant.update).not.toHaveBeenCalled();
  });
}

it("automatically completes the normal leader approval for the authenticated leader's own valid record", async () => {
  const mock = client();
  const person = await mock.eventParticipant.findUnique();
  person.internalReference = "leader-self:" + ids.user;
  await updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person, data, keys, undefined, 1);
  expect(mock.eventParticipant.update).toHaveBeenLastCalledWith({ where: { id: ids.person }, data: { status: "LEADER_APPROVED", version: { increment: 1 } } });
  expect(validateParticipantEligibility).toHaveBeenCalledTimes(1);
  expect(mock.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "PARTICIPANT_APPROVED" }) }));
});
it("never auto-approves another worker, even if their marker belongs to a different leader", async () => {
  const mock = client(); (await mock.eventParticipant.findUnique()).internalReference = "leader-self:" + randomUUID();
  await updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person, data, keys, undefined, 1);
  expect(mock.eventParticipant.update).toHaveBeenCalledTimes(1);
  expect(validateParticipantEligibility).not.toHaveBeenCalled();
});
it("keeps duplicate self records in duplicate review", async () => {
  const mock = client(); (await mock.eventParticipant.findUnique()).internalReference = "leader-self:" + ids.user;
  mock.eventParticipant.count.mockResolvedValue(1);
  await updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person, data, keys, undefined, 1);
  expect(mock.eventParticipant.update).toHaveBeenCalledTimes(1);
  expect(validateParticipantEligibility).not.toHaveBeenCalled();
});
it("rolls back a self save when normal eligibility approval rejects it", async () => {
  const mock = client(); (await mock.eventParticipant.findUnique()).internalReference = "leader-self:" + ids.user;
  vi.mocked(validateParticipantEligibility).mockRejectedValueOnce(new Error("SUBMISSION_INCOMPLETE"));
  await expect(updateParticipantByLeader(mock as unknown as PrismaClient, context, ids.person, data, keys, undefined, 1)).rejects.toThrow("SUBMISSION_INCOMPLETE");
  expect(mock.eventParticipant.update).toHaveBeenCalledTimes(1);
});
