import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { ensureLeaderSelfParticipant, linkLeaderSelfParticipant, leaderSelfProfiles, leaderSelfProfileComplete } from "../../packages/domain/src/participants/leader-self.ts";
import { registrationCapabilities } from "../../packages/domain/src/submissions/capabilities.ts";

vi.mock("../../packages/config/src/index.ts", () => ({ syntheticMode: () => false, deploymentMode: () => "production" }));
vi.mock("../../packages/domain/src/shared/transaction.ts", () => ({ transaction: async (db: unknown, work: (tx: unknown) => unknown) => work(db) }));
vi.mock("../../packages/domain/src/submissions/capabilities.ts", () => ({ registrationCapabilities: vi.fn() }));
const ids = { user: randomUUID(), company: randomUUID(), event: randomUUID(), registration: randomUUID(), person: randomUUID() };
const context = { clerkUserId: "synthetic-leader", correlationId: randomUUID() };
const caps = { zones: true, vehicle: true, add: true, submit: true, employeeLinks: true };
const marker = "leader-self:" + ids.user;
const full = { id: ids.person, status: "AWAITING_LEADER_REVIEW", erasedAt: null,
  fullName: "Synthetic leader", dateOfBirth: new Date("1990-01-01"), documentNumberFingerprint: "a".repeat(64),
  documentExpiryDate: new Date("2035-01-01"), documentType: "PASSPORT", mobileE164: "+351912345678", nationalityCode: "PT",
  jobRoleId: randomUUID(), photoObjectKey: "synthetic/photo", privacyAcknowledgedAt: new Date(), workDays: [{ workDate: new Date("2030-01-01") }] };

function client() {
  let own: { id: string; internalReference: string | null; status: string; erasedAt: Date | null } | null = null;
  const r = { id: ids.registration, companyId: ids.company, eventId: ids.event, erasedAt: null,
    personnelLimit: 3, company: { name: "Synthetic company" }, event: { name: "Synthetic event" }, participants: [] as (typeof full)[] };
  const person = { id: ids.person, registrationId: ids.registration, internalReference: null as string | null, version: 1, status: "DRAFT", erasedAt: null };
  const mock = {
    user: { findUnique: vi.fn(async () => ({ id: ids.user, role: "COMPANY_LEADER" as "COMPANY_LEADER" | "ADMIN", disabledAt: null })) },
    company: { findUnique: vi.fn(async () => ({ deactivatedAt: null, internalOrganisation: null })) },
    companyLeaderMembership: { findUnique: vi.fn(async () => ({ revokedAt: null as Date | null })) },
    companyEventRegistration: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === r.id ? r : null),
      findUniqueOrThrow: vi.fn(async () => r), findMany: vi.fn(async () => [r]) },
    event: { findUniqueOrThrow: vi.fn(async () => ({ name: r.event.name })) },
    privacyErasureJob: { count: vi.fn(async () => 0) },
    privacyNotice: { findFirst: vi.fn(async () => ({ id: randomUUID(), version: "v1", textPt: "Approved fixture notice.", textEn: "Approved fixture notice.", synthetic: false })) },
    eventRetentionPolicy: { findFirst: vi.fn(async () => ({ id: randomUUID() })) },
    eventParticipant: { findUnique: vi.fn(async () => own),
      findFirst: vi.fn(async ({ where }: { where: { id: string; registrationId: string } }) => where.id === person.id && where.registrationId === person.registrationId ? person : null),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: { internalReference: string } }) => {
        own = { id: ids.person, internalReference: data.internalReference, status: "DRAFT", erasedAt: null }; return own;
      }),
      updateMany: vi.fn(async () => { own = { ...person, internalReference: marker }; return { count: 1 }; }),
    },
    auditEvent: { create: vi.fn(async () => ({})) }, $queryRaw: vi.fn(async () => [{ unsafe: false }]),
  };
  return { mock, db: mock as unknown as PrismaClient, person, setOwn: (value: typeof own) => { own = value; } };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(registrationCapabilities).mockResolvedValue(caps); });

it("creates exactly one normal worker per leader and registration on repeated starts", async () => {
  const f = client();
  const first = await ensureLeaderSelfParticipant(f.db, context, ids.registration);
  expect(await ensureLeaderSelfParticipant(f.db, context, ids.registration)).toEqual(first);
  expect(f.mock.eventParticipant.create).toHaveBeenCalledTimes(1);
  expect(f.mock.eventParticipant.create).toHaveBeenCalledWith({ data: { registrationId: ids.registration, eventId: ids.event, internalReference: marker } });
  expect(f.mock.auditEvent.create).toHaveBeenCalledTimes(1);
});
it("counts the leader against the existing personnel limit", async () => {
  const f = client(); f.mock.eventParticipant.count.mockResolvedValue(3);
  await expect(ensureLeaderSelfParticipant(f.db, context, ids.registration)).rejects.toThrow("PERSONNEL_LIMIT_REACHED");
  expect(f.mock.eventParticipant.create).not.toHaveBeenCalled();
});
it("recovers an identical concurrent start without a second worker", async () => {
  const f = client();
  f.mock.eventParticipant.create.mockImplementationOnce(async () => {
    f.setOwn({ id: ids.person, internalReference: marker, status: "DRAFT", erasedAt: null });
    throw Object.assign(new Error("Synthetic unique conflict"), { code: "P2002" });
  });
  expect(await ensureLeaderSelfParticipant(f.db, context, ids.registration)).toEqual({ participantId: ids.person });
  expect(f.mock.eventParticipant.create).toHaveBeenCalledTimes(1);
});
it("links an existing worker without increasing headcount or replacing their data", async () => {
  const f = client();
  await linkLeaderSelfParticipant(f.db, context, { registrationId: ids.registration, participantId: ids.person });
  expect(f.mock.eventParticipant.create).not.toHaveBeenCalled();
  expect(f.mock.eventParticipant.updateMany).toHaveBeenCalledWith({ where: { id: ids.person, registrationId: ids.registration, version: 1, internalReference: null }, data: { internalReference: marker, version: { increment: 1 } } });
});
it("rejects revoked membership and other registrations before creating a worker", async () => {
  const f = client(); f.mock.companyLeaderMembership.findUnique.mockResolvedValue({ revokedAt: new Date() });
  await expect(ensureLeaderSelfParticipant(f.db, context, ids.registration)).rejects.toThrow("FORBIDDEN");
  await expect(ensureLeaderSelfParticipant(f.db, context, randomUUID())).rejects.toThrow("FORBIDDEN");
  expect(f.mock.eventParticipant.create).not.toHaveBeenCalled();
});
it("does not let another leader's marker be overwritten", async () => {
  const f = client(); f.person.internalReference = "leader-self:" + randomUUID();
  await expect(linkLeaderSelfParticipant(f.db, context, { registrationId: ids.registration, participantId: ids.person })).rejects.toThrow("FORBIDDEN");
  expect(f.mock.eventParticipant.updateMany).not.toHaveBeenCalled();
});
it("does not resurrect removed self records or enrol administrators", async () => {
  const f = client(); f.setOwn({ id: ids.person, internalReference: marker, status: "REMOVED", erasedAt: null });
  await expect(ensureLeaderSelfParticipant(f.db, context, ids.registration)).rejects.toThrow("EDIT_LOCKED");
  f.mock.user.findUnique.mockResolvedValue({ id: ids.user, role: "ADMIN", disabledAt: null });
  await expect(ensureLeaderSelfParticipant(f.db, context, ids.registration)).rejects.toThrow("FORBIDDEN");
  expect(f.mock.eventParticipant.create).not.toHaveBeenCalled();
});
it("requires complete personal details, photo and actual privacy acknowledgement", () => {
  expect(leaderSelfProfileComplete(full)).toBe(true);
  expect(leaderSelfProfileComplete(null)).toBe(false);
  expect(leaderSelfProfileComplete({ ...full, photoObjectKey: null })).toBe(false);
  expect(leaderSelfProfileComplete({ ...full, privacyAcknowledgedAt: null })).toBe(false);
  expect(leaderSelfProfileComplete({ ...full, documentNumberFingerprint: null })).toBe(false);
  expect(leaderSelfProfileComplete({ ...full, workDays: [] })).toBe(false);
});
it("requires a profile for an editable registration and preserves closed-event read access", async () => {
  const f = client();
  expect((await leaderSelfProfiles(f.db, context))[0]).toMatchObject({ required: true, complete: false });
  vi.mocked(registrationCapabilities).mockResolvedValue({ ...caps, add: false });
  expect((await leaderSelfProfiles(f.db, context))[0]).toMatchObject({ required: false, complete: false });
  expect(f.mock.companyEventRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    erasedAt: null, company: { deactivatedAt: null, internalOrganisation: null, memberships: { some: { userId: ids.user, revokedAt: null } } },
  }) }));
});
it("does not trap an account after its own worker record has been withdrawn", async () => {
  const f = client();
  f.mock.companyEventRegistration.findMany.mockResolvedValue([{ id: ids.registration, companyId: ids.company, eventId: ids.event,
    erasedAt: null, personnelLimit: 3, company: { name: "Synthetic company" }, event: { name: "Synthetic event" },
    participants: [{ ...full, status: "REMOVED" }] }]);
  expect((await leaderSelfProfiles(f.db, context))[0]).toMatchObject({ required: false, complete: false });
});
