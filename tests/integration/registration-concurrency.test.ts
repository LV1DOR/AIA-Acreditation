import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { configureRegistration } from "../../packages/domain/src/index.ts";
afterAll(() => db.$disconnect());
it("allows exactly one concurrent write for an expected version", async () => {
  const f = await fixture(db);
  const input = { registrationId: f.registration.id, expectedVersion: 1, zoneIds: [], vehicle: { required: false as const, requestedQuantity: 0 as const, justification: null } };
  const results = await Promise.allSettled([configureRegistration(db, f.leaderActor, input), configureRegistration(db, f.leaderActor, input)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(r => r.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.code).toBe("STALE_WRITE");
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).version).toBe(2);
  expect(await db.auditEvent.count({ where: { entityId: f.registration.id } })).toBe(1);
  expect(await db.outboxMessage.count({ where: { deduplicationKey: "registration:" + f.registration.id + ":2" } })).toBe(1);
});

