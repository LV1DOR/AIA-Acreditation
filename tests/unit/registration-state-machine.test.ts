import { expect, it } from "vitest";
import { transition } from "../../packages/domain/src/submissions/state-machine.ts";
import type { EditScope } from "../../packages/domain/src/submissions/edit-policy.ts";
const now = new Date("2026-09-21T12:00:00Z");
const base: EditScope = { status: "DRAFT", event: { status: "ONBOARDING_OPEN", onboardingOpensAt: new Date("2026-09-20"), onboardingClosesAt: new Date("2026-09-22") } };
it("submits draft and returned packages to AIA", () => {
  for (const status of ["DRAFT", "RETURNED_FOR_CORRECTION"] as const) expect(transition({ ...base, status }, "COMPANY_LEADER", { action: "SUBMIT" }, now).status).toBe("AIA_REVIEW");
});
it("reopening invalidates approval", () => {
  expect(transition({ ...base, status: "APPROVED" }, "COMPANY_LEADER", { action: "REOPEN" }, now)).toEqual({ status: "DRAFT", invalidatesApproval: true });
  expect(() => transition({ ...base, status: "APPROVED" }, "COMPANY_LEADER", { action: "REOPEN" }, new Date("2026-09-22"))).toThrow("DEADLINE_CLOSED");
});
it("admin may review only the review state", () => {
  expect(transition({ ...base, status: "AIA_REVIEW" }, "ADMIN", { action: "APPROVE" }, now).status).toBe("APPROVED");
  expect(() => transition(base, "ADMIN", { action: "APPROVE" }, now)).toThrow("INVALID_TRANSITION");
  expect(() => transition({ ...base, status: "AIA_REVIEW" }, "COMPANY_LEADER", { action: "APPROVE" }, now)).toThrow("FORBIDDEN");
});
it.each(["RETURN", "REJECT"] as const)("%s requires category and substantive comment", action => {
  expect(() => transition({ ...base, status: "AIA_REVIEW" }, "ADMIN", { action, reason: "OTHER", comment: "  " }, now)).toThrow();
  expect(transition({ ...base, status: "AIA_REVIEW" }, "ADMIN", { action, reason: "OTHER", comment: "Please review." }, now).status).toBe(action === "RETURN" ? "RETURNED_FOR_CORRECTION" : "REJECTED");
});
it("rejected packages do not silently return to draft", () => {
  expect(() => transition({ ...base, status: "REJECTED" }, "COMPANY_LEADER", { action: "SUBMIT" }, now)).toThrow();
  expect(() => transition({ ...base, status: "REJECTED" }, "COMPANY_LEADER", { action: "REOPEN" }, now)).toThrow();
});

