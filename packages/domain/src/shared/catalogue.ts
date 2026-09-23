import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "./actor.ts";
import { transaction } from "./transaction.ts";
import { DomainError } from "./errors.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
const fields = z.object({ name: z.string().trim().min(1).max(200), sortOrder: z.number().int().nonnegative().default(0) }).strict();
const update = fields.extend({ id: z.uuid(), expectedVersion: z.number().int().positive(), active: z.boolean() }).strict();
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
        const args = { where: { id: input.id, version: input.expectedVersion }, data: { name: input.name, sortOrder: input.sortOrder, deactivatedAt: input.active ? null : new Date(), version: { increment: 1 } } };
        const result = kind === "Zone" ? await tx.zone.updateMany(args) : await tx.jobRole.updateMany(args);
        if (result.count !== 1) throw new DomainError("STALE_WRITE");
        const version = input.expectedVersion + 1;
        await appendAudit(tx, actor, { action: kind === "Zone" ? "ZONE_UPDATED" : "JOB_ROLE_UPDATED", entityType: kind, entityId: input.id, metadata: { version } });
        await enqueueInvalidation(tx, kind + ":" + input.id + ":" + version, { entityId: input.id, version });
        return { id: input.id, version };
      });
    }
  };
}

