import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { idAllAttendees, type IdAllAttendee } from "../../packages/domain/src/exports/id-all.ts";
import { encryptSubmissionSnapshot } from "../../packages/domain/src/submissions/snapshot-crypto.ts";

const key = "a".repeat(64);

function fixture(internal: boolean, companyNames: (string | undefined)[]) {
  const eventId = randomUUID(), zoneId = randomUUID();
  const rows = companyNames.map((name, index) => {
    const participantId = randomUUID(), submissionId = randomUUID();
    const snapshot = {
      company: { name, internalOrganisation: internal ? "AIA" : null },
      zones: internal ? [] : [{ id: zoneId }],
      participants: [{ id: participantId, version: 2, fullName: `Synthetic ${index}`, jobRole: { name: "Operations" }, photoObjectKey: `photo/${participantId}`, zones: internal ? [{ id: zoneId }] : [] }],
    };
    return {
      company: { name: `Unapproved workspace company ${index}` },
      participants: [{ id: participantId, version: 2 }],
      submissions: [{ id: submissionId, snapshot: encryptSubmissionSnapshot(JSON.stringify(snapshot), key, submissionId), reviews: [{ outcome: "APPROVED" }], photoAdjustments: [] }],
    };
  });
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: randomUUID(), role: "ADMIN", disabledAt: null }) },
    event: { findUnique: vi.fn().mockResolvedValue({ id: eventId }) },
    companyEventRegistration: { findMany: vi.fn().mockResolvedValue(rows) },
    eventZone: { findMany: vi.fn().mockResolvedValue([{ zoneId }]) },
  };
  const db = { $transaction: vi.fn(async (work: (client: typeof tx) => Promise<IdAllAttendee[]>) => work(tx)) } as unknown as PrismaClient;
  return { db, eventId, context: { clerkUserId: "synthetic-admin", correlationId: randomUUID() } };
}

it.each([false, true])("uses each approved snapshot's company name rather than the live workspace name (internal=%s)", async internal => {
  const f = fixture(internal, ["Rescues AIA MC", "SPM SPA - AIR FENCE"]);
  const attendees = await idAllAttendees(f.db, f.context, f.eventId, key);
  expect(attendees.map(person => [person.fullName, person.companyName])).toEqual([
    ["Synthetic 0", "Rescues AIA MC"],
    ["Synthetic 1", "SPM SPA - AIR FENCE"],
  ]);
});

it.each([undefined, "", "   "])("rejects missing approved company names (%s) instead of exporting a blank or unapproved name", async companyName => {
  const f = fixture(false, [companyName]);
  await expect(idAllAttendees(f.db, f.context, f.eventId, key)).rejects.toThrow();
});
