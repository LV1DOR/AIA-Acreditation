import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { protectDocumentNumber } from "../../packages/domain/src/participants/identity.ts";
import { stagePhotoUpload } from "../../packages/domain/src/participants/photo-lifecycle.ts";
import type { fixture } from "./foundation.ts";

export async function syntheticPhoto(db: PrismaClient, participantId: string) {
  const person = await db.eventParticipant.findUniqueOrThrow({ where: { id: participantId } });
  return (await stagePhotoUpload(db, person, "aia-phase1-synthetic")).objectKey;
}

export async function readyPerson(db: PrismaClient, f: Awaited<ReturnType<typeof fixture>>, name = "Ready Person", encryptionKey = "1".repeat(64)) {
  const id = randomUUID();
  const role = await db.jobRole.create({ data: { name: `Synthetic role ${id}` } });
  return db.eventParticipant.create({ data: {
    id, registrationId: f.registration.id, eventId: f.event.id, status: "LEADER_APPROVED", fullName: name,
    dateOfBirth: new Date("1990-01-01"), documentType: "PASSPORT",
    ...protectDocumentNumber("PASSPORT", id, id, encryptionKey, "2".repeat(64)),
    documentExpiryDate: new Date("2035-01-01"), mobileE164: "+351912345678", nationalityCode: "PT", jobRoleId: role.id,
    photoObjectKey: `photos/synthetic/${id}.jpg`, privacyAcknowledgedAt: new Date(), privacyNoticeVersion: "test-v1",
    workDays: { create: { workDate: f.event.startDate } },
  } });
}

export async function readyConfiguration(db: PrismaClient, f: Awaited<ReturnType<typeof fixture>>) {
  const zone = await db.zone.create({ data: { name: `Synthetic zone ${randomUUID()}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: false } });
  return zone;
}
