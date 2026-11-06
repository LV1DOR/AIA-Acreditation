import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import type { ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { decryptSubmissionSnapshot } from "../submissions/snapshot-crypto.ts";

export type IdAllAttendee = { id: string; fullName: string; role: string; photoObjectKey: string; companyName: string };
export class IdAllExportError extends Error {
  constructor(public readonly code: "NO_APPROVED_ATTENDEES" | "INCOMPLETE_ATTENDEE" | "PHOTO_UNAVAILABLE", public readonly attendeeName?: string) {
    super(code);
  }
}

const zone = z.object({ id: z.uuid() });
const snapshotSchema = z.object({
  company: z.object({ name: z.string().trim().min(1), internalOrganisation: z.enum(["AIA", "PARKALGAR"]).nullish() }),
  zones: z.array(zone),
  participants: z.array(z.object({
    id: z.uuid(), version: z.number(), fullName: z.string().nullable(),
    jobRole: z.object({ name: z.string() }).nullable(), photoObjectKey: z.string().nullable(),
    zones: z.array(zone).optional(),
  })),
});

// A read-only export: no issuance, export marker, code allocation or print status.
// Always reload the complete event, independent of table filters or earlier downloads.
export async function idAllAttendees(db: PrismaClient, context: ActorContext, eventId: string, key: string): Promise<IdAllAttendee[]> {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    if (!z.uuid().safeParse(eventId).success) throw new DomainError("INVALID_INPUT");
    if (!await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })) throw new DomainError("NOT_FOUND");
    const registrations = await tx.companyEventRegistration.findMany({
      where: { eventId, status: "APPROVED", withdrawnAt: null, erasedAt: null, company: { deactivatedAt: null } },
      select: {
        participants: { where: { status: "LEADER_APPROVED", erasedAt: null }, select: { id: true, version: true } },
        submissions: {
          orderBy: { version: "desc" }, take: 1,
          select: {
            id: true, snapshot: true,
            reviews: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { outcome: true } },
            photoAdjustments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { participantId: true, photoObjectKey: true } },
          },
        },
      },
    });
    const activeZones = new Set((await tx.eventZone.findMany({
      where: { eventId, deactivatedAt: null, zone: { deactivatedAt: null } }, select: { zoneId: true },
    })).map(item => item.zoneId));
    const attendees: IdAllAttendee[] = [];
    for (const registration of registrations) {
      const submission = registration.submissions[0];
      if (!submission || submission.reviews[0]?.outcome !== "APPROVED") continue;
      const snapshot = snapshotSchema.parse(decryptSubmissionSnapshot(submission.snapshot, key, submission.id));
      const people = new Map(snapshot.participants.map(person => [person.id, person]));
      const adjustments = new Map<string, string>();
      for (const adjustment of submission.photoAdjustments) {
        if (!adjustments.has(adjustment.participantId)) adjustments.set(adjustment.participantId, adjustment.photoObjectKey);
      }
      for (const current of registration.participants) {
        const person = people.get(current.id);
        if (!person || person.version !== current.version) continue;
        const zones = snapshot.company.internalOrganisation ? person.zones ?? [] : snapshot.zones;
        if (zones.some(item => !activeZones.has(item.id))) continue;
        const photoObjectKey = adjustments.get(person.id) ?? person.photoObjectKey;
        if (!person.fullName?.trim() || !person.jobRole?.name.trim() || !photoObjectKey || photoObjectKey === "[erased]") {
          throw new IdAllExportError("INCOMPLETE_ATTENDEE", person.fullName ?? undefined);
        }
        attendees.push({ id: person.id, fullName: person.fullName, role: person.jobRole.name, photoObjectKey, companyName: snapshot.company.name });
      }
    }
    if (!attendees.length) throw new IdAllExportError("NO_APPROVED_ATTENDEES");
    return attendees.sort((a, b) => a.fullName.localeCompare(b.fullName, "pt") || a.id.localeCompare(b.id));
  });
}
