import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { removeCompanyFromEvent, removePersonFromEvent } from "../../packages/domain/src/admin/event-removal.ts";
import { resolveActor } from "../../packages/domain/src/auth/authorization.ts";
import { invalidateEffectiveApproval } from "../../packages/domain/src/submissions/integrity.ts";
import { recordNotifications } from "../../packages/domain/src/notifications/record.ts";

vi.mock("../../packages/domain/src/shared/transaction.ts", () => ({ transaction: async (db: unknown, work: (tx: unknown) => unknown) => work(db) }));
vi.mock("../../packages/domain/src/auth/authorization.ts", async importOriginal => ({ ...await importOriginal<object>(), resolveActor: vi.fn() }));
vi.mock("../../packages/domain/src/submissions/integrity.ts", () => ({ invalidateEffectiveApproval: vi.fn() }));
vi.mock("../../packages/domain/src/notifications/record.ts", () => ({ recordNotifications: vi.fn() }));
const ids = { registration: randomUUID(), company: randomUUID(), event: randomUUID(), person: randomUUID(), submission: randomUUID(), user: randomUUID() };
const context = { clerkUserId: "synthetic-admin", correlationId: randomUUID() };
function fixture() {
  const registration = { id: ids.registration, companyId: ids.company, eventId: ids.event, version: 3, status: "APPROVED", withdrawnAt: null as Date | null, erasedAt: null };
  const person = { id: ids.person, registrationId: ids.registration, eventId: ids.event, status: "LEADER_APPROVED", version: 2, erasedAt: null, registration };
  const db = {
    companyEventRegistration: { findUnique: vi.fn(async () => registration), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => registration) },
    eventParticipant: { findUnique: vi.fn(async () => person), updateMany: vi.fn(async () => ({ count: 1 })) },
    companySubmission: { findFirst: vi.fn(async () => ({ id: ids.submission })) },
    companySubmissionReview: { create: vi.fn(async () => ({})) },
    privacyErasureJob: { count: vi.fn(async () => 0) },
    employeeInvitationToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    leaderInvitation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    companyRequest: { updateMany: vi.fn(async () => ({ count: 1 })) },
    companyLeaderMembership: { findMany: vi.fn(async () => [{ userId: ids.user }]) },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxMessage: { create: vi.fn(async () => ({})) },
  };
  return { mock: db, db: db as unknown as PrismaClient, registration, person };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveActor).mockResolvedValue({ role: "ADMIN", userId: ids.user, correlationId: context.correlationId }); });
const companyInput = () => ({ id: ids.registration, eventId: ids.event, expectedVersion: 3 });
const personInput = () => ({ id: ids.person, eventId: ids.event, expectedVersion: 2 });
it("withdraws an approved registration only in the selected event and preserves submission bytes", async () => {
  const f = fixture();
  await expect(removeCompanyFromEvent(f.db, context, companyInput())).resolves.toEqual({ id: ids.registration, alreadyRemoved: false });
  expect(f.mock.companyEventRegistration.updateMany).toHaveBeenCalledWith({ where: { id: ids.registration, eventId: ids.event, version: 3, withdrawnAt: null }, data: { withdrawnAt: expect.any(Date), status: "REJECTED", version: { increment: 1 } } });
  expect(f.mock.eventParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { registrationId: ids.registration, status: { notIn: ["REMOVED", "REPLACED"] } } }));
  expect(f.mock.leaderInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { registrationId: ids.registration, usedAt: null, revokedAt: null } }));
  expect(f.mock.companySubmissionReview.create).toHaveBeenCalledWith({ data: { submissionId: ids.submission, outcome: "APPROVAL_INVALIDATED", reviewedByUserId: ids.user } });
  expect(recordNotifications).toHaveBeenCalledWith(f.mock, [expect.objectContaining({ registrationId: ids.registration, eventId: ids.event, parameters: { updateKind: "REGISTRATION_REMOVED" } })]);
});
it("removes a submitted person without deleting history, photos, or changing other people's approval", async () => {
  const f = fixture();
  await removePersonFromEvent(f.db, context, personInput());
  expect(f.mock.eventParticipant.updateMany).toHaveBeenCalledWith({ where: { id: ids.person, eventId: ids.event, version: 2, status: "LEADER_APPROVED" }, data: { status: "REMOVED", version: { increment: 1 } } });
  expect(f.mock.companyEventRegistration.update).toHaveBeenCalledWith({ where: { id: ids.registration }, data: { version: { increment: 1 } } });
  expect(f.mock.companySubmissionReview.create).not.toHaveBeenCalled();
  expect(f.mock.employeeInvitationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { participantId: ids.person, usedAt: null, revokedAt: null } }));
});
it("repeats a completed withdrawal without extra writes or emails", async () => {
  const f = fixture(); f.registration.withdrawnAt = new Date();
  expect((await removeCompanyFromEvent(f.db, context, companyInput())).alreadyRemoved).toBe(true);
  f.person.status = "REMOVED";
  expect((await removePersonFromEvent(f.db, context, personInput())).alreadyRemoved).toBe(true);
  expect(f.mock.companyEventRegistration.updateMany).not.toHaveBeenCalled();
  expect(f.mock.eventParticipant.updateMany).not.toHaveBeenCalled();
  expect(recordNotifications).not.toHaveBeenCalled();
});
it("rejects cross-event, stale, non-admin and erasure-in-progress actions before updates", async () => {
  const f = fixture();
  await expect(removeCompanyFromEvent(f.db, context, { ...companyInput(), eventId: randomUUID() })).rejects.toThrow("NOT_FOUND");
  await expect(removePersonFromEvent(f.db, context, { ...personInput(), eventId: randomUUID() })).rejects.toThrow("NOT_FOUND");
  await expect(removeCompanyFromEvent(f.db, context, { ...companyInput(), expectedVersion: 1 })).rejects.toThrow("STALE_WRITE");
  await expect(removePersonFromEvent(f.db, context, { ...personInput(), expectedVersion: 1 })).rejects.toThrow("STALE_WRITE");
  f.mock.privacyErasureJob.count.mockResolvedValue(1);
  await expect(removeCompanyFromEvent(f.db, context, companyInput())).rejects.toThrow("EDIT_LOCKED");
  await expect(removePersonFromEvent(f.db, context, personInput())).rejects.toThrow("EDIT_LOCKED");
  vi.mocked(resolveActor).mockResolvedValue({ role: "COMPANY_LEADER", userId: ids.user, correlationId: context.correlationId });
  await expect(removeCompanyFromEvent(f.db, context, companyInput())).rejects.toThrow("FORBIDDEN");
  await expect(removePersonFromEvent(f.db, context, personInput())).rejects.toThrow("FORBIDDEN");
  expect(f.mock.eventParticipant.updateMany).not.toHaveBeenCalled();
  expect(f.mock.companyEventRegistration.updateMany).not.toHaveBeenCalled();
});
it("stops before dependent writes if the compare-and-update loses a concurrent race", async () => {
  const f = fixture(); f.mock.companyEventRegistration.updateMany.mockResolvedValue({ count: 0 });
  await expect(removeCompanyFromEvent(f.db, context, companyInput())).rejects.toThrow("STALE_WRITE");
  f.mock.eventParticipant.updateMany.mockResolvedValue({ count: 0 });
  await expect(removePersonFromEvent(f.db, context, personInput())).rejects.toThrow("STALE_WRITE");
  expect(f.mock.employeeInvitationToken.updateMany).not.toHaveBeenCalled();
  expect(recordNotifications).not.toHaveBeenCalled();
});

it("returns an in-flight review for correction when a person is removed", async () => {
  const f = fixture(); f.registration.status = "AIA_REVIEW";
  await removePersonFromEvent(f.db, context, personInput());
  expect(invalidateEffectiveApproval).toHaveBeenCalledWith(f.mock, expect.objectContaining({ role: "ADMIN" }), ids.registration);
});
