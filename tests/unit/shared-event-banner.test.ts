import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { eventBannerAccess } from "../../packages/domain/src/events/service.ts";
vi.mock("../../packages/domain/src/auth/authorization.ts", () => ({ resolveActor: vi.fn(async () => ({ userId: "synthetic-user", role: "COMPANY_LEADER" })), requireAdmin: vi.fn() }));
it("authorizes a leader banner only through active membership of a non-erased event registration", async () => {
  const id = randomUUID(), findFirst = vi.fn(async () => ({ bannerObjectKey: "synthetic-event-banner" }));
  expect(await eventBannerAccess({ event: { findFirst } } as unknown as PrismaClient, { clerkUserId: "synthetic-clerk", correlationId: randomUUID() }, id)).toBe("synthetic-event-banner");
  expect(findFirst).toHaveBeenCalledWith({ where: { id, registrations: { some: { erasedAt: null, company: { deactivatedAt: null, internalOrganisation: null, memberships: { some: { userId: "synthetic-user", revokedAt: null } } } } } }, select: { bannerObjectKey: true } });
});
it("does not disclose a banner for an unrelated event or a missing image", async () => {
  const db = { event: { findFirst: vi.fn(async () => null) } };
  await expect(eventBannerAccess(db as unknown as PrismaClient, { clerkUserId: "synthetic-clerk", correlationId: randomUUID() }, randomUUID())).rejects.toThrow("NOT_FOUND");
});
