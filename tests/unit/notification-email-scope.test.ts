import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { businessEmailMembershipAllowed } from "../../packages/domain/src/notifications/business-email.ts";
it("retains active-membership authorization for regular email", async () => {
  const db = { companyLeaderMembership: { count: vi.fn(async () => 1) } };
  expect(await businessEmailMembershipAllowed(db as unknown as PrismaClient, "REQUEST_APPROVED", "synthetic-company", "synthetic-user")).toBe(true);
});
it("never sends ordinary decisions to a revoked or unrelated member", async () => {
  const db = { companyLeaderMembership: { count: vi.fn(async () => 0) } };
  expect(await businessEmailMembershipAllowed(db as unknown as PrismaClient, "REQUEST_APPROVED", "synthetic-company", "synthetic-user")).toBe(false);
  expect(db.companyLeaderMembership.count).toHaveBeenCalledTimes(1);
});
it("allows only the minimal access-removal notice to a verifiably former member", async () => {
  const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  expect(await businessEmailMembershipAllowed({ companyLeaderMembership: { count } } as unknown as PrismaClient, "ACCESS_REMOVED", "synthetic-company", "synthetic-user")).toBe(true);
  expect(count).toHaveBeenLastCalledWith({ where: { companyId: "synthetic-company", userId: "synthetic-user", revokedAt: { not: null } } });
});
it("does not grant notice delivery to a user who never belonged to the company", async () => {
  const count = vi.fn(async () => 0);
  expect(await businessEmailMembershipAllowed({ companyLeaderMembership: { count } } as unknown as PrismaClient, "ACCESS_REMOVED", "synthetic-company", "synthetic-user")).toBe(false);
});
