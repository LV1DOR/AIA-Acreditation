import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { effectiveEventStatus } from "../events/lifecycle.ts";

export async function adminEventOptions(db: PrismaClient, context: ActorContext) {
  requireAdmin(await resolveActor(db, context));
  return db.event.findMany({
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    select: { id: true, name: true, startDate: true, endDate: true },
  });
}

export async function adminOperations(db: PrismaClient, context: ActorContext, eventId?: string) {
  requireAdmin(await resolveActor(db, context));
  const events = await db.event.findMany({
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    select: { id: true, name: true, startDate: true, endDate: true, onboardingOpensAt: true, onboardingClosesAt: true, timezone: true, status: true, bannerObjectKey: true },
  });
  const selected = events.find(event => event.id === eventId) ?? events[0] ?? null;
  if (!selected) return { events, event: null, registrations: [], historicalRegistrations: [], participants: [], requests: [], activity: [] };

  const [registrations, participants, requests, activity] = await Promise.all([
    db.companyEventRegistration.findMany({
      where: { eventId: selected.id }, orderBy: { company: { name: "asc" } },
      select: {
        id: true, version: true, withdrawnAt: true, eventId: true, companyId: true, status: true, personnelLimit: true, createdAt: true, updatedAt: true,
        company: { select: { name: true, internalOrganisation:true, deactivatedAt: true } },
        primaryLeader: { select: { userId: true } },
        invitations: { where: { usedAt: { not: null } }, orderBy: { usedAt: "desc" }, select: { emailNormalized: true, acceptedByUserId: true } },
        zones: { select: { eventZone: { select: { zone: { select: { id: true, name: true } } } } } },
        vehiclePass: { select: { id: true, required: true, requestedQuantity: true, justification: true, requestedAt: true, approvedQuantity: true, decisionComment: true, decidedAt: true, version: true } },
        submissions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, submittedAt: true } },
        _count: { select: { participants: { where: { status: { in: ["AWAITING_LEADER_REVIEW", "LEADER_APPROVED", "DUPLICATE_REVIEW_REQUIRED"] } } }, requests: true } },
      },
    }),
    db.eventParticipant.findMany({
      where: { eventId: selected.id, registration: {withdrawnAt:null}, status: { notIn: ["REMOVED", "REPLACED"] } },
      orderBy: [{ fullName: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, version: true, registrationId: true, fullName: true, status: true, dateOfBirth: true, documentType: true,
        documentNumberLast3: true, documentExpiryDate: true, mobileE164: true, nationalityCode: true,
        photoObjectKey: true, privacyAcknowledgedAt: true, createdAt: true, updatedAt: true,
        individualZones:{select:{eventZone:{select:{zone:{select:{id:true,name:true}}}}}},
        jobRole: { select: { name: true } },
        workDays: { orderBy: { workDate: "asc" }, select: { workDate: true } },
        registration: { select: { status: true, company: { select: { name: true, internalOrganisation:true } } } },
      },
    }),
    db.companyRequest.findMany({
      where: { registration: { eventId: selected.id, withdrawnAt: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, registrationId: true, type: true, priority: true, reason: true, payload: true, status: true,
        resolutionComment: true, createdAt: true, reviewedAt: true, version: true,
        targetParticipant: { select: { id: true, fullName: true } },
        registration: { select: { company: { select: { name: true } } } },
      },
    }),
    db.auditEvent.findMany({
      where: { eventId: selected.id, action: { in: ["SUBMISSION_CREATED", "SUBMISSION_APPROVED", "SUBMISSION_RETURNED", "SUBMISSION_REJECTED", "REQUEST_SUBMITTED", "REQUEST_APPROVED", "REQUEST_REJECTED", "VEHICLE_PASS_APPROVED", "VEHICLE_PASS_REJECTED"] } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 12,
      select: { id: true, occurredAt: true, action: true, entityType: true, entityId: true, companyId: true },
    }),
  ]);
  return { events, event: { ...selected, status: effectiveEventStatus(selected) }, registrations: registrations.filter(r => !r.withdrawnAt), historicalRegistrations: registrations, participants, requests, activity };
}
