import { z } from "zod";
import { ReviewReasonCategory, type CompanyRegistrationStatus } from "@aia/database";
import type { EditScope } from "./edit-policy.ts";
import { assertLeaderCanEdit, onboardingOpen } from "./edit-policy.ts";
import { DomainError } from "../shared/errors.ts";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUBMIT") }).strict(),
  z.object({ action: z.literal("REOPEN") }).strict(),
  z.object({ action: z.literal("APPROVE") }).strict(),
  z.object({ action: z.literal("RETURN"), reason: z.enum(ReviewReasonCategory), comment: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ action: z.literal("REJECT"), reason: z.enum(ReviewReasonCategory), comment: z.string().trim().min(1).max(4000) }).strict(),
]);
export type TransitionCommand = z.infer<typeof commandSchema>;
// Policy only: persistence must create immutable snapshots/reviews in Phase 5.
export function transition(scope: EditScope, role: "ADMIN" | "COMPANY_LEADER", raw: TransitionCommand, now: Date): { status: CompanyRegistrationStatus; invalidatesApproval: boolean } {
  const command = commandSchema.parse(raw);
  if (command.action === "SUBMIT") {
    if (role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    assertLeaderCanEdit(scope, now);
    return { status: "AIA_REVIEW", invalidatesApproval: false };
  }
  if (command.action === "REOPEN") {
    if (role !== "COMPANY_LEADER") throw new DomainError("FORBIDDEN");
    if (!onboardingOpen(scope, now)) throw new DomainError("DEADLINE_CLOSED");
    if (scope.status !== "APPROVED") throw new DomainError("INVALID_TRANSITION");
    return { status: "DRAFT", invalidatesApproval: true };
  }
  if (role !== "ADMIN") throw new DomainError("FORBIDDEN");
  if (scope.status !== "AIA_REVIEW") throw new DomainError("INVALID_TRANSITION");
  return { status: command.action === "APPROVE" ? "APPROVED" : command.action === "RETURN" ? "RETURNED_FOR_CORRECTION" : "REJECTED", invalidatesApproval: false };
}

