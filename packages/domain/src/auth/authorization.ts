import {deploymentMode} from "@aia/config";
import {assertRestrictedDatabaseRuntime} from "../operations/database-role.ts";
import type { PrismaClient } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import { actorSchema, type ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";

type AuthorizationClient = Pick<PrismaClient | Tx, "user" | "companyLeaderMembership" | "company">;

export function assertCompanyActive(company: { deactivatedAt: Date | null } | null) {
  if (!company || company.deactivatedAt) throw new DomainError("FORBIDDEN");
}

export async function resolveActor(tx: Pick<AuthorizationClient, "user">, context: ActorContext) {
  if(deploymentMode()==="production"){const runtime=tx as typeof tx & Partial<Pick<PrismaClient,"$queryRaw">>;if(!runtime.$queryRaw)throw new DomainError("FORBIDDEN");await assertRestrictedDatabaseRuntime(runtime as Pick<PrismaClient,"$queryRaw">);}
  const heartbeat=(tx as typeof tx & {operationalHeartbeat?:PrismaClient["operationalHeartbeat"]}).operationalHeartbeat;
  if(heartbeat && (await heartbeat.findUnique({where:{id:"restore-quarantine"}}))?.errorCount)throw new DomainError("FORBIDDEN");
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
  const company = await tx.company.findUnique({ where: { id: companyId } });
  assertCompanyActive(company);
  if (company?.internalOrganisation) throw new DomainError("FORBIDDEN");
  const membership = await tx.companyLeaderMembership.findUnique({ where: { companyId_userId: { companyId, userId: actor.userId } } });
  if (!membership || membership.revokedAt) throw new DomainError("FORBIDDEN");
}

export function assertRegistrationActive(registration: { withdrawnAt?: Date | null }) {
  if (registration.withdrawnAt) throw new DomainError("EDIT_LOCKED");
}
