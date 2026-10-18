import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { DomainError } from "../shared/errors.ts";

const input = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive(), confirmed: z.literal(true) }).strict();

// Configuration cleanup for unused drafts, never a participant/history erasure
// shortcut. Serializable checks and restrictive FKs protect concurrent use.
export async function deleteUnusedEvent(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const event = await tx.event.findUnique({ where: { id: data.id } });
    if (!event) throw new DomainError("NOT_FOUND");
    if (event.version !== data.expectedVersion) throw new DomainError("STALE_WRITE");
    if (event.status !== "DRAFT") throw new DomainError("EVENT_DELETE_BLOCKED");
    if ((await tx.operationalHeartbeat.findUnique({ where: { id: "restore-quarantine" } }))?.errorCount) throw new DomainError("EVENT_DELETE_BLOCKED");
    const where = { eventId: data.id };
    const references = await Promise.all([
      tx.companyEventRegistration.count({ where }), tx.eventParticipant.count({ where }),
      tx.privacyNotice.count({ where }), tx.privacyAcknowledgement.count({ where }),
      tx.eventRetentionPolicy.count({ where }), tx.eventPrivacyHold.count({ where }),
      tx.privacyErasureJob.count({ where }), tx.storageDeletion.count({ where }),
      tx.notification.count({ where }),
      tx.outboxMessage.count({ where: { ...where, type: { not: "DOMAIN_INVALIDATION" } } }),
    ]);
    if (references.some(count => count > 0)) throw new DomainError("EVENT_DELETE_BLOCKED");
    if (event.bannerObjectKey) {
      // Only this draft's own banner enters the existing verified worker cleanup.
      if (!event.bannerObjectKey.startsWith(`events/${event.id}/branding/`)) throw new DomainError("EVENT_DELETE_BLOCKED");
      const bucket = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).parse(process.env.MINIO_PHOTOS_BUCKET);
      await tx.storageDeletion.create({ data: { bucket, objectKey: event.bannerObjectKey, eventId: event.id } });
    }
    // Event-specific selections only; shared catalogue rows remain untouched.
    await tx.eventZone.deleteMany({ where });
    const deleted = await tx.event.deleteMany({ where: { id: data.id, version: data.expectedVersion, status: "DRAFT" } });
    if (deleted.count !== 1) throw new DomainError("STALE_WRITE");
    await appendAudit(tx, actor, { action: "EVENT_DELETED", entityType: "Event", entityId: event.id, eventId: event.id, metadata: { version: data.expectedVersion } });
    await enqueueInvalidation(tx, `event:${event.id}:deleted:${data.expectedVersion + 1}`, { entityId: event.id, eventId: event.id, version: data.expectedVersion + 1 });
    return { id: event.id };
  });
}
