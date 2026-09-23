import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { createDatabase } from "../../packages/database/src/index.ts";
import { issueLeaderInvitation, revokeLeaderInvitation } from "../../packages/domain/src/index.ts";
import { expect, test } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
const secretKey = process.env.CLERK_SECRET_KEY;
if (!databaseUrl || !secretKey?.startsWith("sk_test_")) throw new Error("LIVE_CLERK_E2E_CONFIGURATION_REQUIRED");
const databaseTarget = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(databaseTarget.hostname) || databaseTarget.pathname !== "/aia_acreditacao_test") {
  throw new Error("LIVE_CLERK_E2E_REQUIRES_ISOLATED_LOCAL_DATABASE");
}

const db = createDatabase(databaseUrl);
const clerkApi = createClerkClient({ secretKey });
const suffix = randomUUID().slice(0, 8);
const email = (role: string) => `aia-acreditacao-${role}+clerk_test_${suffix}@example.com`;

type State = {
  adminEmail: string;
  leaderEmail: string;
  invitedEmail: string;
  ownCompany: string;
  otherCompany: string;
  invitedCompany: string;
  validToken: string;
  expiredToken: string;
  revokedToken: string;
};
let state: State;
const createdClerkUserIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const adminEmail = email("admin"), leaderEmail = email("leader"), invitedEmail = email("invited");
  const clerkUsers = [];
  for (const address of [adminEmail, leaderEmail, invitedEmail]) {
    const user = await clerkApi.users.createUser({ emailAddress: [address], skipPasswordRequirement: true, skipLegalChecks: true });
    clerkUsers.push(user);
    createdClerkUserIds.push(user.id);
  }
  const adminClerk = clerkUsers[0]!;
  const leaderClerk = clerkUsers[1]!;
  const admin = await db.user.create({ data: { clerkUserId: adminClerk.id, role: "ADMIN" } });
  const leader = await db.user.create({ data: { clerkUserId: leaderClerk.id, role: "COMPANY_LEADER" } });
  const ownCompany = `E2E Own Company ${suffix}`;
  const otherCompany = `E2E Isolated Company ${suffix}`;
  const invitedCompany = `E2E Invited Company ${suffix}`;
  const [own, other, invited] = await Promise.all([
    db.company.create({ data: { name: ownCompany } }),
    db.company.create({ data: { name: otherCompany } }),
    db.company.create({ data: { name: invitedCompany } }),
  ]);
  const membership = await db.companyLeaderMembership.create({ data: { companyId: own.id, userId: leader.id } });
  const event = await db.event.create({ data: {
    name: `E2E Event ${suffix}`,
    startDate: new Date("2030-06-01T00:00:00.000Z"),
    endDate: new Date("2030-06-03T00:00:00.000Z"),
    onboardingOpensAt: new Date("2029-01-01T00:00:00.000Z"),
    onboardingClosesAt: new Date("2030-05-31T22:59:59.000Z"),
    status: "DRAFT",
  } });
  await db.companyEventRegistration.create({ data: { eventId: event.id, companyId: own.id, primaryLeaderMembershipId: membership.id } });
  await db.companyEventRegistration.create({ data: { eventId: event.id, companyId: other.id } });
  const invitationRegistration = await db.companyEventRegistration.create({ data: { eventId: event.id, companyId: invited.id } });
  const actor = { clerkUserId: adminClerk.id, correlationId: randomUUID() };
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const valid = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  const expired = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  await db.leaderInvitation.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } });
  const revoked = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  await revokeLeaderInvitation(db, actor, revoked.id);
  state = {
    adminEmail, leaderEmail, invitedEmail,
    ownCompany, otherCompany, invitedCompany,
    validToken: valid.token, expiredToken: expired.token, revokedToken: revoked.token,
  };
  expect(admin.id).toBeTruthy();
});

test.afterAll(async () => {
  await Promise.allSettled(createdClerkUserIds.map(userId => clerkApi.users.deleteUser(userId)));
  await db.$disconnect();
});

test("unauthenticated portal access redirects to Clerk sign-in", async ({ page }) => {
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/sign-in/);
  await expect(page.locator(".cl-signIn-root")).toBeVisible();
});

test("mapped admin account reaches the admin portal", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/admin/);
  await expect(page.getByRole("heading", { name: "Your operations centre" })).toBeVisible();
});

test("company leader sees only companies granted by PostgreSQL membership", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto("/en/company");
  await expect(page.getByText(state.ownCompany)).toBeVisible();
  await expect(page.getByText(state.otherCompany)).toHaveCount(0);
});

test("verified matching Clerk identity accepts a one-time invitation", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.invitedEmail });
  await page.goto(`/api/invitations/start?locale=en&token=${encodeURIComponent(state.validToken)}`);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/en\/company/);
  await expect(page.getByText(state.invitedCompany)).toBeVisible();
  await page.goto(`/api/invitations/start?locale=en&token=${encodeURIComponent(state.validToken)}`);
  await expect(page.getByText("This invitation is unavailable for this account.")).toBeVisible();
});

for (const kind of ["expired", "revoked"] as const) {
  test(`${kind} invitation is rejected without revealing its state`, async ({ page }) => {
    const token = kind === "expired" ? state.expiredToken : state.revokedToken;
    await page.goto(`/api/invitations/start?locale=en&token=${encodeURIComponent(token)}`);
    await expect(page.getByText("This invitation is unavailable for this account.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
  });
}
