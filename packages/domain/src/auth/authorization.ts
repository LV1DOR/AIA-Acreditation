import type { PrismaClient } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import { actorSchema, type ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";

type AuthorizationClient = Pick<PrismaClient | Tx, "user" | "companyLeaderMembership">;

export async function resolveActor(tx: AuthorizationClient, context: ActorContext) {
  const input = actorSchema.parse(context);
  const user = await tx.user.findUnique({ where: { clerkUserId: input.clerkUserId } });
  if (!user || user.disabledAt) throw new DomainError("FORBIDDEN");
  return { userId: user.id, role: user.role, correlationId: input.correlationId };
}
export type ResolvedActor = Awaited<ReturnType<typeof resolveActor>>;
export function requireAdmin(actor: ResolvedActor) {
  if (actor.role !== "ADMIN") throw new DomainError("FORBIDDEN");
}
export async function requireCompany(tx: AuthorizationClient, actor: ResolvedActor, companyId: string) {
  if (actor.role === "ADMIN") return;
  const membership = await tx.companyLeaderMembership.findUnique({ where: { companyId_userId: { companyId, userId: actor.userId } } });
  if (!membership || membership.revokedAt) throw new DomainError("FORBIDDEN");
}
