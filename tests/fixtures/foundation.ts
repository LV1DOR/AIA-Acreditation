import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../packages/database/src/index.ts";
export async function fixture(db: PrismaClient) {
  const admin = await db.user.create({ data: { clerkUserId: "fixture-admin-" + randomUUID(), role: "ADMIN" } });
  const leader = await db.user.create({ data: { clerkUserId: "fixture-leader-" + randomUUID(), role: "COMPANY_LEADER" } });
  const company = await db.company.create({ data: { name: "Synthetic company " + randomUUID() } });
  const membership = await db.companyLeaderMembership.create({ data: { companyId: company.id, userId: leader.id } });
  const event = await db.event.create({ data: {
    name: "Synthetic event", startDate: new Date("2026-10-01"), endDate: new Date("2026-10-03"),
    onboardingOpensAt: new Date(Date.now() - 86400000), onboardingClosesAt: new Date(Date.now() + 86400000), status: "ONBOARDING_OPEN"
  } });
  const registration = await db.companyEventRegistration.create({ data: { companyId: company.id, eventId: event.id, primaryLeaderMembershipId: membership.id } });
  const actor = (clerkUserId: string) => ({ clerkUserId, correlationId: randomUUID() });
  return { admin, leader, company, membership, event, registration, adminActor: actor(admin.clerkUserId), leaderActor: actor(leader.clerkUserId) };
}
