import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { resolveActor, requireAdmin, requireCompany } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
export async function adminOverview(db: PrismaClient, context: ActorContext) {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    const [events, companies, registrations, reviewCount, recentEvents, pending] = await Promise.all([
      tx.event.count(), tx.company.count({ where: { deactivatedAt: null } }), tx.companyEventRegistration.count(),
      tx.companyEventRegistration.count({ where: { status: "AIA_REVIEW" } }),
      tx.event.findMany({ orderBy: { startDate: "desc" }, take: 20, select: { id: true, name: true, startDate: true, endDate: true, status: true, _count: { select: { registrations: true } } } }),
      tx.companyEventRegistration.findMany({ where: { status: "AIA_REVIEW" }, orderBy: { updatedAt: "asc" }, take: 30, select: { id: true, company: { select: { name: true } }, event: { select: { name: true } }, status: true } }),
    ]);
    return { events, companies, registrations, reviewCount, recentEvents, pending };
  });
}
export async function leaderOverview(db: PrismaClient, context: ActorContext) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    return tx.companyEventRegistration.findMany({
      where: { company: { deactivatedAt: null, memberships: { some: { userId: actor.userId, revokedAt: null } } } },
      orderBy: { event: { startDate: "desc" } },
      select: { id: true, status: true, personnelLimit: true, company: { select: { name: true } },
        event: { select: { name: true, startDate: true, endDate: true, onboardingClosesAt: true } },
        zones: { select: { eventZone: { select: { zone: { select: { name: true } } } } } },
      },
    });
  });
}
export async function auditOverview(db: PrismaClient, context: ActorContext) {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    return tx.auditEvent.findMany({ orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, occurredAt: true, action: true, actorType: true, entityType: true, entityId: true } });
  });
}
export async function notificationOverview(db: PrismaClient, context: ActorContext) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    return tx.notification.findMany({ where: { recipientUserId: actor.userId }, orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, type: true, createdAt: true, readAt: true } });
  });
}

export async function adminSetup(db: PrismaClient, context: ActorContext) {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    const [events, zones, jobRoles, companies, registrations] = await Promise.all([
      tx.event.findMany({ orderBy: [{ startDate: "desc" }, { name: "asc" }], include: { zones: { include: { zone: true }, orderBy: { zone: { sortOrder: "asc" } } } } }),
      tx.zone.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      tx.jobRole.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      tx.company.findMany({ orderBy: { name: "asc" } }),
      tx.companyEventRegistration.findMany({ orderBy: [{ event: { startDate: "desc" } }, { company: { name: "asc" } }], include: {
        company: true, event: true,
        invitations: { orderBy: { createdAt: "desc" }, take: 3, select: { id: true, emailNormalized: true, expiresAt: true, usedAt: true, revokedAt: true } },
      } }),
    ]);
    return { events, zones, jobRoles, companies, registrations };
  });
}

export async function leaderRegistration(db: PrismaClient, context: ActorContext, registrationId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: registrationId }, include: {
      company: true, event: { include: { zones: { where: { deactivatedAt: null, zone: { deactivatedAt: null } }, include: { zone: true }, orderBy: { zone: { sortOrder: "asc" } } } } },
      zones: true, vehiclePass: true,
    } });
    if (!registration) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, registration.companyId);
    return registration;
  });
}
