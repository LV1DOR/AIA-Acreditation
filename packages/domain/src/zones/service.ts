import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@aia/database";
import { catalogue } from "../shared/catalogue.ts";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { DomainError } from "../shared/errors.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
export const zones = catalogue("Zone");
const input = z.object({ eventId: z.uuid(), zoneId: z.uuid() }).strict();
export async function activateEventZone(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const zone = await tx.zone.findUnique({ where: { id: data.zoneId } });
    if (!zone || zone.deactivatedAt) throw new DomainError("INVALID_INPUT");
    const existing = await tx.eventZone.findUnique({ where: { eventId_zoneId: data } });
    const link = existing ? await tx.eventZone.update({ where: { id: existing.id }, data: { deactivatedAt: null } }) : await tx.eventZone.create({ data });
    await appendAudit(tx, actor, { action: "EVENT_ZONE_ACTIVATED", entityType: "EventZone", entityId: link.id, eventId: data.eventId });
    await enqueueInvalidation(tx, `event-zone:${link.id}:active:${randomUUID()}`, { entityId: link.id, eventId: data.eventId, version: 1 });
    return link;
  });
}

export async function deactivateEventZone(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const link = await tx.eventZone.findUnique({ where: { eventId_zoneId: data } });
    if (!link || link.deactivatedAt) throw new DomainError("INVALID_INPUT");
    const requested = await tx.companyZoneRequest.count({ where: { eventId: data.eventId, zoneId: data.zoneId } });
    if (requested || await tx.participantZoneRequest.count({where:{eventId:data.eventId,zoneId:data.zoneId}})) throw new DomainError("ZONE_IN_USE");
    await tx.eventZone.update({ where: { id: link.id }, data: { deactivatedAt: new Date() } });
    await appendAudit(tx, actor, { action: "EVENT_ZONE_DEACTIVATED", entityType: "EventZone", entityId: link.id, eventId: data.eventId });
    await enqueueInvalidation(tx, `event-zone:${link.id}:inactive:${randomUUID()}`, { entityId: link.id, eventId: data.eventId, version: 1 });
  });
}
