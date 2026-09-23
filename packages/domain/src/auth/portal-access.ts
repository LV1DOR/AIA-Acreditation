import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { actorSchema } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { appendAudit } from "../audit/append.ts";

export async function portalAccess(db: PrismaClient, raw: ActorContext) {
  const context = actorSchema.parse(raw);
  const user = await db.user.findUnique({ where: { clerkUserId: context.clerkUserId }, select: { id: true, role: true, disabledAt: true } });
  if (!user || user.disabledAt) return { status: "NO_ACCESS" as const };
  return { status: "GRANTED" as const, userId: user.id, role: user.role };
}
export async function recordSessionAccess(db: PrismaClient, context: ActorContext, sessionId: string) {
  const validSessionId = z.string().min(1).max(200).parse(sessionId);
  const fingerprint = createHash("sha256").update(validSessionId).digest("hex");
  return transaction(db, async tx => {
    const { resolveActor } = await import("./authorization.ts");
    const actor = await resolveActor(tx, context);
    const id = randomUUID();
    const inserted = await tx.authSession.createMany({ data: [{ id, userId: actor.userId, fingerprint }], skipDuplicates: true });
    if (inserted.count) await appendAudit(tx, actor, { action: "SESSION_ACCESS_GRANTED", entityType: "AuthSession", entityId: id });
  });
}
