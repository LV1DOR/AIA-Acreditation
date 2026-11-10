import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { updateEvent } from "../../packages/domain/src/events/service.ts";

const mocked = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("../../packages/domain/src/submissions/integrity.ts", () => ({ invalidateEffectiveApproval: mocked.invalidate }));
beforeEach(() => vi.resetAllMocks());

function fixture() {
  const event = { id: randomUUID(), version: 8, name: "Synthetic event", status: "ONBOARDING_OPEN", timezone: "Europe/Lisbon", startDate: new Date("2026-11-13"), endDate: new Date("2026-11-15"), onboardingOpensAt: new Date("2026-10-01T00:00:00Z"), onboardingClosesAt: new Date("2026-11-12T23:55:00Z") };
  const registrationId = randomUUID();
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: randomUUID(), role: "ADMIN", disabledAt: null }) },
    event: { findUniqueOrThrow: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    companyEventRegistration: { findMany: vi.fn().mockResolvedValue([{ id: registrationId }]) },
    eventParticipant: { updateMany: vi.fn().mockResolvedValue({ count: 20 }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    outboxMessage: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  const input = { id: event.id, expectedVersion: 8, name: event.name, timezone: event.timezone, startDate: "2026-11-13", endDate: "2026-11-15", onboardingOpensAt: event.onboardingOpensAt.toISOString(), onboardingClosesAt: event.onboardingClosesAt.toISOString(), publicationState: "PUBLISHED" as "PUBLISHED" | "DRAFT" };
  return { db, tx, event, registrationId, input, actor: { clerkUserId: "synthetic-admin", correlationId: randomUUID() } };
}

it.each(["2026-11-17T23:55:00.000Z", "2026-11-09T23:55:00.000Z"])("preserves approvals and worker versions when only the closing deadline changes to %s", async deadline => {
  const f = fixture();
  expect(await updateEvent(f.db, f.actor, { ...f.input, onboardingClosesAt: deadline })).toEqual({ id: f.event.id, version: 9 });
  expect(f.tx.event.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: f.event.id, version: 8 }, data: expect.objectContaining({ onboardingClosesAt: new Date(deadline), version: { increment: 1 } }) }));
  expect(mocked.invalidate).not.toHaveBeenCalled();
  expect(f.tx.companyEventRegistration.findMany).not.toHaveBeenCalled();
  expect(f.tx.eventParticipant.updateMany).not.toHaveBeenCalled();
  expect(f.tx.auditEvent.create).toHaveBeenCalledOnce();
  expect(f.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "EVENT_UPDATED", metadata: { version: 9 } }) }));
  expect(f.tx.outboxMessage.create).toHaveBeenCalledOnce();
  expect(f.tx.outboxMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "DOMAIN_INVALIDATION", eventId: f.event.id }) }));
});

it.each([
  { name: "Changed event" }, { timezone: "Europe/Berlin" }, { startDate: "2026-11-12" },
  { endDate: "2026-11-16" }, { onboardingOpensAt: "2026-10-02T00:00:00.000Z" }, { publicationState: "DRAFT" as const },
])("still invalidates approvals when an existing review requirement changes: %j", async change => {
  const f = fixture();
  await updateEvent(f.db, f.actor, { ...f.input, onboardingClosesAt: "2026-11-17T23:55:00.000Z", ...change });
  expect(mocked.invalidate).toHaveBeenCalledOnce();
  expect(mocked.invalidate).toHaveBeenCalledWith(f.tx, expect.objectContaining({ role: "ADMIN" }), f.registrationId);
  expect(f.tx.eventParticipant.updateMany).toHaveBeenCalledWith({ where: { eventId: f.event.id, status: "LEADER_APPROVED" }, data: { status: "AWAITING_LEADER_REVIEW", version: { increment: 1 } } });
});

it("rejects stale deadline edits before approval changes, audit or invalidation", async () => {
  const f = fixture();f.tx.event.updateMany.mockResolvedValue({ count: 0 });
  await expect(updateEvent(f.db, f.actor, { ...f.input, onboardingClosesAt: "2026-11-17T23:55:00.000Z" })).rejects.toMatchObject({ code: "STALE_WRITE" });
  expect(mocked.invalidate).not.toHaveBeenCalled();expect(f.tx.auditEvent.create).not.toHaveBeenCalled();expect(f.tx.outboxMessage.create).not.toHaveBeenCalled();
});
