import type { CompanyRegistrationStatus, EventStatus, UserRole } from "@aia/database";
import { DomainError } from "../shared/errors.ts";
export interface EditScope {
  status: CompanyRegistrationStatus;
  event: { status: EventStatus; onboardingOpensAt: Date; onboardingClosesAt: Date };
}
export function onboardingOpen(scope: EditScope, now: Date): boolean {
  return scope.event.status === "ONBOARDING_OPEN" && now >= scope.event.onboardingOpensAt && now < scope.event.onboardingClosesAt;
}
export function assertLeaderCanEdit(scope: EditScope, now: Date) {
  if (!onboardingOpen(scope, now)) throw new DomainError("DEADLINE_CLOSED");
  if (scope.status !== "DRAFT" && scope.status !== "RETURNED_FOR_CORRECTION") throw new DomainError("EDIT_LOCKED");
}
export function assertCanEdit(scope: EditScope, role: UserRole, now: Date, overrideReason?: string) {
  if (role !== "ADMIN") return assertLeaderCanEdit(scope, now);
  if ((!onboardingOpen(scope, now) || !["DRAFT", "RETURNED_FOR_CORRECTION"].includes(scope.status)) && !overrideReason?.trim()) {
    throw new DomainError("OVERRIDE_REASON_REQUIRED");
  }
}

