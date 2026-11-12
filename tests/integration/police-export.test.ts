import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { policeExportData, policeHeaders } from "../../packages/domain/src/exports/police.ts";
import { protectDocumentNumber } from "../../packages/domain/src/participants/identity.ts";
import { fixture } from "../fixtures/foundation.ts";
import { db } from "./database.ts";
afterAll(() => db.$disconnect());
it("exports complete decrypted worker/responsible details at every status without altering records", async () => {
  const f = await fixture(db), id = randomUUID(), key = "a".repeat(64), now = new Date();
  await db.leaderInvitation.create({ data: { registrationId: f.registration.id, companyId: f.company.id, emailNormalized: "responsible@example.test", tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), createdAt: now, expiresAt: new Date(now.getTime() + 86400000), usedAt: now, acceptedByUserId: f.leader.id, createdByUserId: f.admin.id } });
  const person = await db.eventParticipant.create({ data: { id, registrationId: f.registration.id, eventId: f.event.id, internalReference: `leader-self:${f.leader.id}`, fullName: "Synthetic Responsible", documentType: "PASSPORT", ...protectDocumentNumber("PASSPORT", "0000123456789012345", id, key, "b".repeat(64)), dateOfBirth: new Date("1990-01-02"), nationalityCode: "PT", mobileE164: "+351912345678" } });
  const removedId = randomUUID();await db.eventParticipant.create({ data: { id: removedId, registrationId: f.registration.id, eventId: f.event.id, fullName: "Removed excluded", status: "REMOVED" } });
  const numberIndex = policeHeaders.indexOf("Número de documento");
  for (const status of ["DRAFT", "AIA_REVIEW", "RETURNED_FOR_CORRECTION", "REJECTED", "APPROVED"] as const) {
    await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status } });
    const data = await policeExportData(db, f.adminActor, f.event.id, key);
    expect(data.workers).toHaveLength(1);expect(data.responsible).toHaveLength(1);expect(data.workers[0]!.values[numberIndex]).toBe("0000123456789012345");expect(data.responsible[0]).toEqual(data.workers[0]);
  }
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id } })).toEqual(person);
  await expect(policeExportData(db, f.leaderActor, f.event.id, key)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { withdrawnAt: new Date(), status: "REJECTED" } });
  expect(await policeExportData(db, f.adminActor, f.event.id, key)).toEqual({ workers: [], responsible: [] });
});
