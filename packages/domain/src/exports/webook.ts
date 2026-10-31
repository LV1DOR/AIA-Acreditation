import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import type { ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { decryptSubmissionSnapshot } from "../submissions/snapshot-crypto.ts";

export type WeBookAttendee = { id: string; fullName: string; zones: string[] };

export class WeBookExportError extends Error {
  constructor(public readonly code: "NO_APPROVED_ATTENDEES" | "INCOMPLETE_ATTENDEE", public readonly attendeeName?: string) {
    super(code);
  }
}

const zoneRef = z.object({ id: z.uuid() });
const snapshotSchema = z.object({
  company: z.object({ internalOrganisation: z.enum(["AIA", "PARKALGAR"]).nullish() }),
  zones: z.array(zoneRef),
  participants: z.array(z.object({
    id: z.uuid(), version: z.number(), fullName: z.string().nullable(),
    zones: z.array(zoneRef).optional(),
  })),
});

// Like the card export, this always reads the complete currently approved set.
// QR values are intentionally left for the operator to paste into the workbook.
export async function weBookAttendees(db: PrismaClient, context: ActorContext, eventId: string, key: string): Promise<WeBookAttendee[]> {
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
          },
        },
      },
    });
    const activeZones = await tx.eventZone.findMany({
      where: { eventId, deactivatedAt: null, zone: { deactivatedAt: null } },
      select: { zoneId: true, zone: { select: { name: true, sortOrder: true } } },
      orderBy: { zone: { sortOrder: "asc" } },
    });
    const zoneById = new Map(activeZones.map(item => [item.zoneId, item.zone.name]));
    const zoneOrder = new Map(activeZones.map((item, index) => [item.zoneId, index]));
    const attendees: WeBookAttendee[] = [];
    for (const registration of registrations) {
      const submission = registration.submissions[0];
      if (!submission || submission.reviews[0]?.outcome !== "APPROVED") continue;
      const snapshot = snapshotSchema.parse(decryptSubmissionSnapshot(submission.snapshot, key, submission.id));
      const people = new Map(snapshot.participants.map(person => [person.id, person]));
      for (const current of registration.participants) {
        const person = people.get(current.id);
        if (!person || person.version !== current.version) continue;
        const assignedZones = snapshot.company.internalOrganisation ? person.zones ?? [] : snapshot.zones;
        if (assignedZones.some(item => !zoneById.has(item.id))) throw new WeBookExportError("INCOMPLETE_ATTENDEE", person.fullName ?? undefined);
        const zones = [...new Set(assignedZones.map(item => item.id))]
          .sort((a, b) => (zoneOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (zoneOrder.get(b) ?? Number.MAX_SAFE_INTEGER))
          .map(id => zoneById.get(id)!);
        if (!person.fullName?.trim() || !zones.length) throw new WeBookExportError("INCOMPLETE_ATTENDEE", person.fullName ?? undefined);
        attendees.push({ id: person.id, fullName: person.fullName.trim(), zones });
      }
    }
    if (!attendees.length) throw new WeBookExportError("NO_APPROVED_ATTENDEES");
    return attendees.sort((a, b) => a.fullName.localeCompare(b.fullName, "pt") || a.id.localeCompare(b.id));
  });
}

export const weBookHeaders = ["QR Code Value", "Full Name", "Zone(s)"] as const;
export const WEBOOK_WORKBOOK = "WeBook.xlsx";

export async function weBookWorkbook(attendees: readonly WeBookAttendee[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("WeBook");
  sheet.columns = weBookHeaders.map((header, index) => ({ header, width: [28, 38, 44][index] }));
  sheet.getColumn(1).numFmt = "@";
  sheet.getRow(1).font = { bold: true };
  for (const attendee of attendees) {
    z.uuid().parse(attendee.id);
    if (!attendee.fullName.trim() || !attendee.zones.length || attendee.zones.some(name => !name.trim())) {
      throw new WeBookExportError("INCOMPLETE_ATTENDEE", attendee.fullName || undefined);
    }
    sheet.addRow([null, attendee.fullName, attendee.zones.join(", ")]);
  }
  if (!attendees.length) throw new WeBookExportError("NO_APPROVED_ATTENDEES");
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
