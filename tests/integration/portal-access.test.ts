import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { portalAccess, recordSessionAccess } from "../../packages/domain/src/auth/portal-access.ts";
import { adminOverview, leaderOverview, auditOverview } from "../../packages/domain/src/portal/queries.ts";
afterAll(() => db.$disconnect());
it("grants mapped admins and never assigns a role to an unknown Clerk account", async () => {
  const f = await fixture(db);
  expect((await portalAccess(db, { ...f.adminActor, clerkUserId: "unknown-account" })).status).toBe("NO_ACCESS");
  expect((await portalAccess(db, f.adminActor)).status).toBe("GRANTED");
  await expect(adminOverview(db, f.leaderActor)).rejects.toThrow("FORBIDDEN");
  await expect(auditOverview(db, f.leaderActor)).rejects.toThrow("FORBIDDEN");
});
it("limits leader query results to active memberships and logs each session once", async () => {
  const f = await fixture(db), other = await fixture(db);
  const rows = await leaderOverview(db, f.leaderActor);
  expect(rows.map(row => row.id)).toContain(f.registration.id);
  expect(rows.map(row => row.id)).not.toContain(other.registration.id);
  await recordSessionAccess(db, f.leaderActor, "synthetic-session-" + f.leader.id);
  await recordSessionAccess(db, f.leaderActor, "synthetic-session-" + f.leader.id);
  expect(await db.auditEvent.count({ where: { actorUserId: f.leader.id, action: "SESSION_ACCESS_GRANTED" } })).toBe(1);
  await db.companyLeaderMembership.update({ where: { id: f.membership.id }, data: { revokedAt: new Date() } });
  expect(await leaderOverview(db, f.leaderActor)).toHaveLength(0);
});
