import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { companyStatusRows } from "../../packages/domain/src/exports/company-status.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";
afterAll(() => db.$disconnect());
it("exports event companies across all workflow states with the primary contact and excludes withdrawn or inactive companies", async () => {
  const f = await fixture(db);
  await db.leaderInvitation.create({ data: { registrationId: f.registration.id, companyId: f.company.id, emailNormalized: "primary@example.test", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), expiresAt: new Date(0), usedAt: new Date(), acceptedByUserId: f.leader.id, createdByUserId: f.admin.id } });
  for (const status of ["DRAFT", "AIA_REVIEW", "RETURNED_FOR_CORRECTION", "REJECTED", "APPROVED"] as const) {
    await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status } });
    expect(await companyStatusRows(db, f.adminActor, f.event.id)).toEqual([{ companyName: f.company.name, email: "primary@example.test", status }]);
  }
  await expect(companyStatusRows(db, f.leaderActor, f.event.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { withdrawnAt: new Date() } });
  expect(await companyStatusRows(db, f.adminActor, f.event.id)).toEqual([]);
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { withdrawnAt: null } });
  await db.company.update({ where: { id: f.company.id }, data: { deactivatedAt: new Date() } });
  expect(await companyStatusRows(db, f.adminActor, f.event.id)).toEqual([]);
});
