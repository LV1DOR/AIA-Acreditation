import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "./actor.ts";
import { transaction } from "./transaction.ts";
import { DomainError } from "./errors.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
const fields = z.object({ name: z.string().trim().min(1).max(200), sortOrder: z.number().int().nonnegative().default(0) }).strict();
const update = fields.extend({ id: z.uuid(), expectedVersion: z.number().int().positive(), active: z.boolean() }).strict();
const remove = z.object({ id: z.uuid() }).strict();
export function catalogue(kind: "Zone" | "JobRole") {
  return {
    async create(db: PrismaClient, context: ActorContext, raw: z.input<typeof fields>) {
      const data = fields.parse(raw);
      return transaction(db, async tx => {
        const actor = await resolveActor(tx, context); requireAdmin(actor);
        const row = kind === "Zone" ? await tx.zone.create({ data }) : await tx.jobRole.create({ data });
        await appendAudit(tx, actor, { action: kind === "Zone" ? "ZONE_CREATED" : "JOB_ROLE_CREATED", entityType: kind, entityId: row.id });
        await enqueueInvalidation(tx, kind + ":" + row.id + ":1", { entityId: row.id, version: 1 });
        return row;
      });
    },
    async update(db: PrismaClient, context: ActorContext, raw: z.input<typeof update>) {
      const input = update.parse(raw);
      return transaction(db, async tx => {
        const actor = await resolveActor(tx, context); requireAdmin(actor);
        const previous = kind === "Zone" ? await tx.zone.findUniqueOrThrow({ where: { id: input.id } }) : await tx.jobRole.findUniqueOrThrow({ where: { id: input.id } });
        if (kind === "Zone" && !input.active) {
          const requested = await tx.companyZoneRequest.count({ where: { zoneId: input.id } });
          if (requested || await tx.participantZoneRequest.count({where:{zoneId:input.id}})) throw new DomainError("ZONE_IN_USE");
        }
        const args = { where: { id: input.id, version: input.expectedVersion }, data: { name: input.name, sortOrder: input.sortOrder, deactivatedAt: input.active ? null : new Date(), version: { increment: 1 } } };
        const result = kind === "Zone" ? await tx.zone.updateMany(args) : await tx.jobRole.updateMany(args);
        if (result.count !== 1) throw new DomainError("STALE_WRITE");
        const eligibilityChanged = previous.name !== input.name || Boolean(previous.deactivatedAt) === input.active;
        const affected = !eligibilityChanged ? [] : kind === "JobRole"
          ? await tx.companyEventRegistration.findMany({ where: { participants: { some: { jobRoleId: input.id, status: { notIn: ["REMOVED", "REPLACED"] } } } }, select: { id: true } })
          : await tx.companyEventRegistration.findMany({ where: { OR: [{ zones: { some: { zoneId: input.id } } }, {participants:{some:{individualZones:{some:{zoneId:input.id}}}}}] }, select: { id: true } });
        for (const registration of affected) await invalidateEffectiveApproval(tx, actor, registration.id);
        if (kind === "JobRole" && eligibilityChanged) await tx.eventParticipant.updateMany({ where: { jobRoleId: input.id, status: "LEADER_APPROVED" }, data: { status: "AWAITING_LEADER_REVIEW", version: { increment: 1 } } });
        const version = input.expectedVersion + 1;
        await appendAudit(tx, actor, { action: kind === "Zone" ? "ZONE_UPDATED" : "JOB_ROLE_UPDATED", entityType: kind, entityId: input.id, metadata: { version } });
        await enqueueInvalidation(tx, kind + ":" + input.id + ":" + version, { entityId: input.id, version });
        return { id: input.id, version };
      });
    },
    async delete(db: PrismaClient, context: ActorContext, raw: z.input<typeof remove>) {
      const input = remove.parse(raw);
      return transaction(db, async tx => {
        const actor = await resolveActor(tx, context); requireAdmin(actor);
        const row = kind === "Zone" ? await tx.zone.findUnique({ where: { id: input.id } }) : await tx.jobRole.findUnique({ where: { id: input.id } });
        if (!row) throw new DomainError("NOT_FOUND");
        const references = kind === "Zone"
          ? (await tx.companyZoneRequest.count({ where: { zoneId: input.id } })) + (await tx.participantZoneRequest.count({where:{zoneId:input.id}}))
          : await tx.eventParticipant.count({ where: { jobRoleId: input.id } });
        if (references) throw new DomainError("CATALOGUE_IN_USE");
        await appendAudit(tx, actor, { action: kind === "Zone" ? "ZONE_DELETED" : "JOB_ROLE_DELETED", entityType: kind, entityId: input.id });
        if (kind === "Zone") {
          await tx.eventZone.deleteMany({ where: { zoneId: input.id } });
          await tx.zone.delete({ where: { id: input.id } });
        } else {
          await tx.jobRole.delete({ where: { id: input.id } });
        }
        await enqueueInvalidation(tx, `${kind}:${input.id}:deleted`, { entityId: input.id, version: row.version + 1 });
        return { id: input.id };
      });
    }
  };
}
