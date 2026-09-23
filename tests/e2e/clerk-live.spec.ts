import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { createDatabase } from "../../packages/database/src/index.ts";
import { issueLeaderInvitation, revokeLeaderInvitation } from "../../packages/domain/src/index.ts";
import { expect, test, type Page } from "@playwright/test";

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
async function useLocalServerActionOrigin(page: Page) {
  // Clerk's testing token runs the page in a privacy-sensitive test context that emits
  // `Origin: null`. Model the normal same-origin browser request without relaxing Next's CSRF gate.
  await page.setExtraHTTPHeaders({ origin: "http://localhost:3200" });
}

type State = {
  adminEmail: string;
  leaderEmail: string;
  invitedEmail: string;
  ownCompany: string;
  otherCompany: string;
  invitedCompany: string;
  ownRegistrationId: string;
  otherRegistrationId: string;
  zoneName: string;
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
    onboardingOpensAt: new Date("2025-01-01T00:00:00.000Z"),
    onboardingClosesAt: new Date("2030-05-31T22:59:59.000Z"),
    status: "ONBOARDING_OPEN",
  } });
  const zoneName = `E2E Paddock ${suffix}`;
  const zone = await db.zone.create({ data: { name: zoneName } });
  await db.eventZone.create({ data: { eventId: event.id, zoneId: zone.id } });
  const ownRegistration = await db.companyEventRegistration.create({ data: { eventId: event.id, companyId: own.id, primaryLeaderMembershipId: membership.id } });
  const otherRegistration = await db.companyEventRegistration.create({ data: { eventId: event.id, companyId: other.id } });
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
    ownCompany, otherCompany, invitedCompany, ownRegistrationId: ownRegistration.id,
    otherRegistrationId: otherRegistration.id, zoneName,
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

test("admin can use the Phase 3 setup portal", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto("/en/admin/setup");
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: "Events and companies" })).toBeVisible();
  const openingPicker = page.locator(".compact-picker-field").filter({ hasText: "Onboarding opens" }).first();
  await expect(openingPicker).toHaveAttribute("data-hydrated", "true");
  await expect(openingPicker.locator("button")).toBeEnabled();
  await openingPicker.locator("button").click();
  await expect(page.getByRole("dialog", { name: "Onboarding opens" })).toBeVisible();
  const datePicker = page.locator(".compact-picker-field").filter({ hasText: "Start date" }).first();
  await datePicker.locator("button").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Start date" })).toBeVisible();
  await expect(page.locator(".MuiDateCalendar-root")).toBeVisible();
  await page.keyboard.press("Escape");
  const publication = page.getByLabel("Publication").first();
  await expect(publication.locator("option")).toHaveText(["Draft", "Published / live"]);
  await expect(page.locator("#zones input[type=number], #roles input[type=number]")).toHaveCount(0);
  const name = `E2E UI Company ${suffix}`;
  await page.getByPlaceholder("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect.poll(() => db.company.count({ where: { name } })).toBe(1);
});

test("company leader sees only companies granted by PostgreSQL membership", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto("/en/company");
  await expect(page.getByText(state.ownCompany)).toBeVisible();
  await expect(page.getByText(state.otherCompany)).toHaveCount(0);
});

test("company leader configures company-wide zones and a vehicle request", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);
  await page.getByText(state.zoneName).click();
  await page.getByText("The company requires a vehicle pass").click();
  await page.getByLabel("Requested quantity").fill("2");
  await page.getByLabel("Required justification").fill("E2E logistics vehicle");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect.poll(async () => {
    const saved = await db.companyEventRegistration.findUniqueOrThrow({
      where: { id: state.ownRegistrationId }, include: { zones: true, vehiclePass: true },
    });
    return { zones: saved.zones.length, vehicles: saved.vehiclePass?.requestedQuantity };
  }).toEqual({ zones: 1, vehicles: 2 });
});

test("company leader cannot open another company's registration", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  const response = await page.goto(`/en/company/${state.otherRegistrationId}`);
  expect(response?.status()).toBe(404);
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
