import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { createDatabase } from "../../packages/database/src/index.ts";
import { approveParticipant, createParticipant, issueEmployeeInvitation, issueLeaderInvitation, revokeLeaderInvitation } from "../../packages/domain/src/index.ts";
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

async function chooseCalendarDate(page: Page, label: string, isoDate: string, initialMonth = new Date().getMonth() + 1) {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  await page.getByRole("button", { name: new RegExp(label) }).click();
  const calendar = page.getByRole("dialog", { name: label });
  await expect(calendar.locator(".MuiDayCalendar-root")).toBeVisible();
  const direction = month < initialMonth ? "Previous month" : "Next month";
  for (let offset = 0; offset < Math.abs(month - initialMonth); offset += 1) {
    await calendar.getByRole("button", { name: direction }).click();
  }
  await calendar.locator("button.MuiPickerDay-root:visible").filter({ hasText: new RegExp(`^${day}$`) }).last().click();
  await expect(calendar.locator(".MuiYearCalendar-root")).toBeVisible();
  await calendar.locator(".MuiYearCalendar-root button").filter({ hasText: new RegExp(`^${year}$`) }).click();
  await expect(calendar).toBeHidden();
}

async function chooseNationality(page: Page) {
  await page.getByRole("combobox", { name: "Nationality" }).click();
  await page.getByPlaceholder("Search country or code...").fill("Portugal");
  await page.locator(".country-popover-content").getByRole("option", { name: /Portugal/ }).click();
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
  eventId: string;
  zoneName: string;
  validToken: string;
  expiredToken: string;
  revokedToken: string;
  jobRoleName: string;
  workerToken: string;
  workerParticipantId: string;
  newLeaderEmail: string;
  newLeaderToken: string;
};
let state: State;
const createdClerkUserIds: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const adminEmail = email("admin"), leaderEmail = email("leader"), invitedEmail = email("invited");
  const newLeaderEmail = email("new-leader");
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
  const leaderActor = { clerkUserId: leaderClerk.id, correlationId: randomUUID() };
  const jobRoleName = `E2E Operations ${suffix}`;
  await db.jobRole.create({ data: { name: jobRoleName } });
  const workerParticipant = await createParticipant(db, leaderActor, ownRegistration.id);
  const workerInvitation = await issueEmployeeInvitation(db, leaderActor, workerParticipant.id, new Date(Date.now() + 60 * 60 * 1000));
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const valid = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  const expired = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  await db.leaderInvitation.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } });
  const revoked = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: invitedEmail, expiresAt });
  await revokeLeaderInvitation(db, actor, revoked.id);
  const newLeader = await issueLeaderInvitation(db, actor, { registrationId: invitationRegistration.id, email: newLeaderEmail, expiresAt });
  state = {
    adminEmail, leaderEmail, invitedEmail,
    ownCompany, otherCompany, invitedCompany, ownRegistrationId: ownRegistration.id,
    otherRegistrationId: otherRegistration.id, eventId: event.id, zoneName,
    validToken: valid.token, expiredToken: expired.token, revokedToken: revoked.token,
    jobRoleName, workerToken: workerInvitation.token, workerParticipantId: workerParticipant.id,
    newLeaderEmail, newLeaderToken: newLeader.token,
  };
  expect(admin.id).toBeTruthy();
});

test.afterAll(async () => {
  const pending = await clerkApi.invitations.getInvitationList({ query: state.newLeaderEmail, status: "pending", limit: 10 });
  await Promise.allSettled(pending.data.map(invitation => clerkApi.invitations.revokeInvitation(invitation.id)));
  await Promise.allSettled(createdClerkUserIds.map(userId => clerkApi.users.deleteUser(userId)));
  await db.$disconnect();
});

test("unauthenticated portal access redirects to Clerk sign-in", async ({ page }) => {
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/sign-in/);
  await expect(page.locator(".cl-signIn-root")).toBeVisible();
});

test("direct account creation is unavailable without an AIA invitation", async ({ page }) => {
  await page.goto("/en/sign-up");
  await expect(page.getByText("Open the complete invitation link sent by AIA.")).toBeVisible();
  await expect(page.locator(".cl-signUp-root")).toHaveCount(0);
});

test("a valid AIA invitation is required before Clerk account creation", async ({ page }) => {
  await page.goto(`/api/invitations/start?locale=en&token=${encodeURIComponent(state.newLeaderToken)}`);
  await page.getByRole("button", { name: "Create an invited account" }).click();
  await expect(page).toHaveURL(/\/en\/sign-up.*__clerk_ticket=/);
  await expect(page.locator(".cl-signUp-root")).toBeVisible();
});

test("mapped admin account reaches the admin portal", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto("/en/admin");
  await expect(page).toHaveURL(/\/en\/admin/);
  await expect(page.getByRole("heading", { name: "Your operations centre" })).toBeVisible();
});

test("admin can use the Phase 3 setup portal", async ({ page }) => {
  const renderLoopErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("Maximum update depth exceeded")) renderLoopErrors.push(message.text());
  });
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
  expect(renderLoopErrors).toEqual([]);
});

test("company leader sees only companies granted by PostgreSQL membership", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto("/en/company");
  await expect(page.getByRole("heading", { name: state.ownCompany })).toBeVisible();
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

test("closed onboarding shows the real reason and disables registration changes", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  const original = await db.event.findUniqueOrThrow({ where: { id: state.eventId }, select: { onboardingClosesAt: true } });
  try {
    await db.event.update({ where: { id: state.eventId }, data: { onboardingClosesAt: new Date(Date.now() - 60_000) } });
    await page.goto(`/en/company/${state.ownRegistrationId}`);
    await expect(page.getByText("The configuration deadline has passed.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save configuration" })).toBeDisabled();
    await page.goto(`/en/company/${state.ownRegistrationId}/participants/${state.workerParticipantId}`);
    await expect(page.getByText("The configuration deadline has passed.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save details" })).toBeDisabled();
  } finally {
    await db.event.update({ where: { id: state.eventId }, data: { onboardingClosesAt: original.onboardingClosesAt } });
  }
});

test("employee completes the mobile one-time onboarding form", async ({ page }) => {
  const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.goto(`/en/onboarding/${state.workerToken}`);
  await page.getByLabel("Full name").fill("E2E Employee");
  await chooseCalendarDate(page, "Date of birth", "1990-01-02");
  await page.getByLabel("Document type").selectOption("PASSPORT");
  await page.getByLabel("Document number").fill("E2E-12345");
  await chooseCalendarDate(page, "Document expiry date", "2030-06-03", 6);
  await page.getByLabel("International mobile number").fill("+351 912 345 678");
  await chooseNationality(page);
  await page.getByLabel("Job role").selectOption({ label: state.jobRoleName });
  await page.locator('input[name="workDays"]').first().check();
  await page.getByLabel("Photo").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: photo });
  await page.getByLabel("I confirm that this privacy notice was presented to me.").check();
  await page.getByRole("button", { name: "Submit details" }).click();
  await expect(page).toHaveURL(/\/en\/onboarding\/complete/);
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: state.workerParticipantId } })).status).toBe("AWAITING_LEADER_REVIEW");
  await page.goto(`/en/onboarding/${state.workerToken}`);
  await expect(page.getByText("This link is unavailable, expired or has already been used.")).toBeVisible();
});

test("company leader directly enters and approves a complete worker", async ({ page }) => {
  const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect.poll(async () => db.eventParticipant.findFirst({ where: { registrationId: state.ownRegistrationId, status: "DRAFT" }, orderBy: { createdAt: "desc" } })).not.toBeNull();
  const created = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  await page.goto(`/en/company/${state.ownRegistrationId}/participants/${created.id}`);
  await page.getByLabel("Full name").fill("E2E Direct Employee");
  await chooseCalendarDate(page, "Date of birth", "1991-02-03");
  await page.getByLabel("Document type").selectOption("CARTAO_CIDADAO");
  await page.getByLabel("Document number").fill("DIRECT-6789");
  await chooseCalendarDate(page, "Document expiry date", "2030-06-03", 6);
  await page.getByLabel("International mobile number").fill("+351 913 456 789");
  await chooseNationality(page);
  await page.getByLabel("Job role").selectOption({ label: state.jobRoleName });
  await page.locator('input[name="workDays"]').first().check();
  await page.getByLabel("Photo").setInputFiles({ name: "profile.png", mimeType: "image/png", buffer: photo });
  await page.getByLabel("I confirm that I presented this notice to the person and recorded their acknowledgement.").check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("AWAITING_LEADER_REVIEW");
  await page.getByRole("button", { name: "Approve person" }).click();
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("LEADER_APPROVED");
});

test("leader submits an immutable version and AIA approves it", async ({ page }) => {
  const leader = await db.user.findFirstOrThrow({ where: { role: "COMPANY_LEADER", memberships: { some: { company: { name: state.ownCompany } } } } });
  await approveParticipant(db, { clerkUserId: leader.clerkUserId, correlationId: randomUUID() }, state.workerParticipantId);
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}/submission`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: "Final Submission" })).toBeVisible();
  await page.getByRole("button", { name: "Submit to AIA" }).click();
  await expect.poll(async () => (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).status).toBe("AIA_REVIEW");
  const submission = await db.companySubmission.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId }, orderBy: { version: "desc" } });
  expect(submission.contentHash).toMatch(/^[a-f0-9]{64}$/);

  await page.goto("/en");
  await clerk.signOut({ page });
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto(`/en/admin/queue/${submission.id}`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: "Review final submission" })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).status).toBe("APPROVED");
});

test("leader can explicitly reopen an approved submission before the deadline", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}/submission`);
  await useLocalServerActionOrigin(page);
  await page.getByRole("button", { name: "Reopen approved submission" }).click();
  await expect.poll(async () => (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).status).toBe("DRAFT");
  const latest = await db.companySubmission.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId }, orderBy: { version: "desc" } });
  expect(await db.companySubmissionReview.count({ where: { submissionId: latest.id, outcome: "APPROVAL_INVALIDATED" } })).toBe(1);
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
  await expect(page.getByRole("heading", { name: state.invitedCompany })).toBeVisible();
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
