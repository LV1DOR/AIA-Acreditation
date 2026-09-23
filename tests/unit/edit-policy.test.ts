import { expect, it } from "vitest";
import { CompanyRegistrationStatus } from "../../packages/database/src/index.ts";
import { assertCanEdit, assertLeaderCanEdit, type EditScope } from "../../packages/domain/src/submissions/edit-policy.ts";
const now = new Date("2026-09-21T12:00:00Z");
const base: EditScope = { status: "DRAFT", event: { status: "ONBOARDING_OPEN", onboardingOpensAt: new Date("2026-09-20T00:00:00Z"), onboardingClosesAt: new Date("2026-09-22T00:00:00Z") } };
it.each(Object.values(CompanyRegistrationStatus))("checks leader editing in %s", status => {
  const operation = () => assertLeaderCanEdit({ ...base, status }, now);
  if (["DRAFT", "RETURNED_FOR_CORRECTION"].includes(status)) expect(operation).not.toThrow();
  else expect(operation).toThrow("EDIT_LOCKED");
});
it.each(["2026-09-19T23:59:59Z", "2026-09-22T00:00:00Z", "2026-09-23T00:00:00Z"])("blocks outside window %s", time => {
  expect(() => assertLeaderCanEdit(base, new Date(time))).toThrow("DEADLINE_CLOSED");
});
it("requires the event to be open as well as the timestamp", () => {
  expect(() => assertLeaderCanEdit({ ...base, event: { ...base.event, status: "ONBOARDING_CLOSED" } }, now)).toThrow();
});
it("allows admin deadline override only with an explicit reason", () => {
  const closed = new Date("2026-09-23T00:00:00Z");
  expect(() => assertCanEdit(base, "ADMIN", closed)).toThrow("OVERRIDE_REASON_REQUIRED");
  expect(() => assertCanEdit(base, "ADMIN", closed, "OTHER")).not.toThrow();
});

