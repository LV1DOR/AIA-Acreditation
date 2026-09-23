import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
const input = z.object({ name: z.string().trim().min(1).max(200) }).strict();
export async function createCompany(db: PrismaClient, context: ActorContext, raw: z.input<typeof input>) {
  const data = input.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const company = await tx.company.create({ data });
    await appendAudit(tx, actor, { action: "COMPANY_CREATED", entityType: "Company", entityId: company.id, companyId: company.id });
    await enqueueInvalidation(tx, "company:" + company.id + ":1", { entityId: company.id, version: 1 });
    return company;
  });
}

