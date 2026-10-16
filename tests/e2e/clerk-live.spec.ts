import { readyPerson } from "../fixtures/security.ts";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseStorageEnv } from "../../packages/config/src/index.ts";
import { workerEffectiveAccess, reviewCompanySubmission, reviewSubmissionParticipant, configureRegistration, createCompanyRequest, decideCompanyRequest } from "../../packages/domain/src/index.ts";
import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { createDatabase } from "../../packages/database/src/index.ts";
import { approveParticipant, createParticipant, issueEmployeeInvitation, issueLeaderInvitation, revokeLeaderInvitation, submitCompanyRegistration } from "../../packages/domain/src/index.ts";
import { fixture } from "../fixtures/foundation.ts";
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
  await page.setExtraHTTPHeaders({ origin: process.env.PLAYWRIGHT_RELEASE_ORIGIN ?? "http://localhost:3200" });
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
// Phase 3 captures are wholly synthetic and contain no credentials or browser chrome.

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
  await db.companyZoneRequest.create({ data: { registrationId: otherRegistration.id, eventId: event.id, zoneId: zone.id } });
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
  const pending = state?.newLeaderEmail?await clerkApi.invitations.getInvitationList({ query: state.newLeaderEmail, status: "pending", limit: 10 }):{data:[]};
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
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".portal-nav").getByText("Account", { exact:true })).toHaveCount(0);
  await page.goto("/en/security");
  await expect(page.getByRole("link", { name:"Back to the app" })).toHaveAttribute("href","/en/portal");
  await page.goto("/en/sign-in");
  await expect(page).toHaveURL(/\/en\/admin/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("admin can use the Phase 3 setup portal", async ({ page }) => {
  test.setTimeout(120_000);
  const renderLoopErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("Maximum update depth exceeded")) renderLoopErrors.push(message.text());
  });
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto("/en/admin/setup");
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: /Event setup/ })).toBeVisible();
  const cards = page.locator(".setup-summary-card");
  await expect(cards).toHaveCount(4);
  const destinations = ["event", "zones", "roles", "branding"];
  for (const [index, destination] of destinations.entries()) {
    await expect(cards.nth(index).getByRole("link")).toHaveAttribute("href", new RegExp(`/en/admin/setup/${destination}\\?eventId=`));
    await expect(cards.nth(index).locator(".setup-summary-body a")).toHaveCount(0);
  }
  await cards.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(/\/en\/admin\/setup\/zones\?eventId=/);
  await expect(page.getByRole("heading", { name: "Zones", exact:true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".admin-event-trigger").click();
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page).toHaveURL(/\/en\/admin\/setup\?wizard=create&step=1/);
  await expect(page.getByRole("heading", { name: "Create event" })).toBeVisible();
  const openingPicker = page.locator(".compact-picker-field").filter({ hasText: "Registration opens" }).first();
  await expect(openingPicker).toHaveAttribute("data-hydrated", "true");
  await expect(openingPicker.locator("button")).toBeEnabled();
  await openingPicker.locator("button").click();
  await expect(page.getByRole("dialog", { name: "Registration opens" })).toBeVisible();
  await page.keyboard.press("Escape");
  const datePicker = page.locator(".compact-picker-field").filter({ hasText: "Start date" }).first();
  await datePicker.locator("button").click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Start date" })).toBeVisible();
  await expect(page.locator(".MuiDateCalendar-root")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/en/admin/setup/event?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Event", exact:true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const publication = page.getByLabel("Status").first();
  await expect(publication.locator("option")).toHaveText(["Draft", "Published / live"]);
  await expect(page.locator("#zones input[type=number], #roles input[type=number]")).toHaveCount(0);
  const currentEvent = await db.event.findUniqueOrThrow({ where:{ id:state.eventId } });
  await page.goto(`/en/admin/setup/event?eventId=${state.eventId}`);
  await expect(page.getByRole("textbox", { name:"Event name" })).toHaveValue(currentEvent.name);
  await expect(page.locator('input[name="startDate"]')).toHaveValue(currentEvent.startDate.toISOString().slice(0,10));
  expect(renderLoopErrors).toEqual([]);
});

test("admin operations use the selected event and dedicated pages", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto(`/en/admin?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.locator(".ops-event-banner")).toContainText(`E2E Event ${suffix}`);
  const zoneSector = page.locator(".ops-chart .recharts-pie-sector");
  const zoneLegend = page.locator(".ops-chart-legend li");
  await expect(zoneSector).toHaveCount(1);
  await expect(zoneLegend.getByTitle(state.zoneName)).toBeVisible();
  await expect(zoneLegend.locator("strong")).toHaveText("1");
  await expect(zoneLegend.locator("small")).toHaveText("100%");
  await zoneSector.hover();
  await expect(page.locator(".chart-tooltip")).toContainText(state.zoneName);
  await expect(page.locator(".portal-nav-group")).toHaveCount(2);
  await expect(page.locator(".portal-nav").getByRole("link", { name: "Companies" })).toHaveAttribute("href", `/en/admin/companies?eventId=${state.eventId}`);
  await expect(page.locator(".portal-nav").getByText("Reports", { exact: true })).toHaveCount(0);
  await page.goto(`/en/admin/companies?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Companies", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search" }).fill(state.ownCompany);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(state.ownCompany);
  await expect(page.locator(".ops-table-scroll tbody tr")).toHaveCount(1);
  await page.locator(".ops-table-scroll tbody").getByRole("link", { name: "View details" }).click();
  await expect(page.getByRole("heading", { name: state.ownCompany })).toBeVisible();
  await page.goto(`/en/admin/people?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await page.goto(`/en/admin/requests?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await page.goto(`/en/admin/vehicles?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Vehicles", exact: true })).toBeVisible();
  await page.goto(`/en/admin/credentials?eventId=${state.eventId}`);
  await expect(page.getByRole("heading", { name: "Credentials", exact: true })).toBeVisible();
});

test("vehicle pass decision leaves the company submission under review", async ({ page }) => {
  test.setTimeout(120_000);
  const f = await fixture(db);
  const zone = await db.zone.create({ data: { name: `Vehicle E2E zone ${f.registration.id}` } });
  await db.eventZone.create({ data: { eventId: f.event.id, zoneId: zone.id } });
  await db.companyZoneRequest.create({ data: { registrationId: f.registration.id, eventId: f.event.id, zoneId: zone.id } });
  const vehicle = await db.vehiclePassRequest.create({ data: { registrationId: f.registration.id, required: true, requestedQuantity: 2, justification: "Transport accreditation equipment", requestedAt: new Date() } });
  await readyPerson(db, f, "Vehicle E2E Worker");
  await submitCompanyRegistration(db, f.leaderActor, { registrationId: f.registration.id, expectedVersion: 1, dataProcessingAccepted: true, dataProcessingNoticeVersion: "test-v1" }, "a".repeat(64));
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto(`/en/admin/vehicles?eventId=${f.event.id}`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: "Vehicles", exact: true })).toBeVisible();
  await expect(page.locator(".ops-table-scroll tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => (await db.vehiclePassRequest.findUniqueOrThrow({ where: { id: vehicle.id } })).approvedQuantity).toBe(2);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: f.registration.id } })).status).toBe("AIA_REVIEW");
  await expect(page.locator(".ops-table-scroll tbody .ops-state")).toHaveText("Approved");
});

test("company leader sees only companies granted by PostgreSQL membership", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto("/en/company");
  await expect(page.getByRole("heading", { name: state.ownCompany })).toBeVisible();
  await expect(page.getByText(state.otherCompany)).toHaveCount(0);
  await expect(page.locator(".portal-nav").getByText("Notifications", { exact:true })).toHaveCount(0);
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

test("leader submits an extra-personnel request and AIA approves it", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}/requests`);
  await useLocalServerActionOrigin(page);
  await page.locator(".request-type-card", { hasText:"Zones" }).click();
  await expect(page.getByLabel(state.zoneName)).toBeVisible();
  await expect(page.getByLabel("Quantity")).toHaveCount(0);
  await page.locator(".request-type-card", { hasText:"Extra personnel" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Reason").fill("Additional operations coverage is required");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect.poll(() => db.companyRequest.count({ where: { registrationId: state.ownRegistrationId, status: "PENDING" } })).toBe(1);
  await clerk.signOut({ page });
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.goto("/en/admin");
  const adminNotification=await db.notification.findFirstOrThrow({where:{type:"REQUEST_SUBMITTED",registrationId:state.ownRegistrationId,readAt:null,recipient:{clerkUserId:createdClerkUserIds[0]!}},orderBy:{createdAt:"desc"}});
  await useLocalServerActionOrigin(page);
  await page.getByRole("button", { name:"Notifications" }).click();
  await expect(page.getByText("New request: extra personnel", { exact:true })).toBeVisible();
  expect((await db.notification.findUniqueOrThrow({where:{id:adminNotification.id}})).readAt).toBeNull();
  const crossOrigin=await page.request.post(`/api/notifications/${adminNotification.id}/read`,{headers:{origin:'https://forged.invalid'},maxRedirects:0});
  expect(crossOrigin.status()).toBe(403);
  expect((await db.notification.findUniqueOrThrow({where:{id:adminNotification.id}})).readAt).toBeNull();
  const readResponse = page.waitForResponse(response => response.url().includes(`/api/notifications/${adminNotification.id}/read`));
  await page.locator(".notification-item",{hasText:"New request: extra personnel"}).click();
  expect((await readResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/en\/admin\/queue/);
  await expect.poll(async ()=>(await db.notification.findUniqueOrThrow({where:{id:adminNotification.id}})).readAt).not.toBeNull();
  await db.notification.create({data:{recipientUserId:adminNotification.recipientUserId,type:"REGISTRATION_UPDATED",parameters:{updateKind:"REQUEST_UPDATED"},registrationId:state.ownRegistrationId,eventId:state.eventId,deduplicationKey:`e2e-mark-all-${randomUUID()}`}});
  await page.goto("/en/admin");
  await page.getByRole("button", { name:"Notifications" }).click();
  await page.getByRole("button", { name:"Mark all as read" }).click();
  await expect.poll(()=>db.notification.count({where:{recipientUserId:adminNotification.recipientUserId,readAt:null}})).toBe(0);
  await page.goto(`/en/admin/requests?eventId=${state.eventId}`);
  await useLocalServerActionOrigin(page);
  const row = page.locator(".ops-request-row", { hasText: "Additional operations coverage is required" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).personnelLimit).toBe(12);
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

test("F05 rejects an oversized public Server Action before token consumption or upload staging", async ({ page }) => {
  await page.goto(`/en/onboarding/${state.workerToken}`);
  const field = page.locator('input[name^="$ACTION_ID_"]');
  await expect(field).toHaveCount(1);
  const actionId = (await field.getAttribute("name"))!.slice("$ACTION_ID_".length);
  const before = await db.photoUpload.count({ where: { participantId: state.workerParticipantId } });
  const response = await page.request.post(`/en/onboarding/${state.workerToken}`, {
    headers: { origin: process.env.PLAYWRIGHT_RELEASE_ORIGIN ?? "http://localhost:3200", "next-action": actionId, "content-type": "text/plain;charset=UTF-8" },
    data: Buffer.alloc(9 * 1024 * 1024 + 1, 0x61), maxRedirects: 0,
  });
  expect(response.status()).toBe(413);
  expect(await db.photoUpload.count({ where: { participantId: state.workerParticipantId } })).toBe(before);
  expect((await db.eventParticipant.findUniqueOrThrow({ where: { id: state.workerParticipantId } })).status).toBe("AWAITING_EMPLOYEE");
  expect((await db.employeeInvitationToken.findFirstOrThrow({ where: { participantId: state.workerParticipantId, revokedAt: null } })).usedAt).toBeNull();
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
  expect(await page.locator('input[name="photo"]').evaluate(input => (input as unknown as { files?: { length: number } }).files?.length)).toBe(0);
  const cropDialog = page.getByRole("dialog", { name: "Adjust photo" });
  await cropDialog.getByRole("button", { name: "Use photo" }).click();
  await expect(cropDialog).toBeHidden();
  expect(await page.locator('input[name="photo"]').evaluate(input => (input as unknown as { files?: { length: number } }).files?.length)).toBe(1);
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
  await page.goto("/en/company");
  const requiredAction = page.getByRole("button", { name: "View profile: E2E Employee" });
  await expect(requiredAction.locator("img")).toBeVisible();
  await requiredAction.click();
  await expect(page.getByRole("dialog", { name: "E2E Employee" })).toContainText("Mobile number");
  await page.getByRole("dialog", { name: "E2E Employee" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("dialog", { name: "Add worker" })).toBeVisible();
  await page.getByRole("button", { name: /Fill in details manually/ }).click();
  await expect.poll(async () => db.eventParticipant.findFirst({ where: { registrationId: state.ownRegistrationId, status: "DRAFT" }, orderBy: { createdAt: "desc" } })).not.toBeNull();
  const created = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  const leader = await db.user.findFirstOrThrow({ where: { role: "COMPANY_LEADER", memberships: { some: { companyId: (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).companyId } } } });
  const obsoleteLink = await issueEmployeeInvitation(db, { clerkUserId: leader.clerkUserId, correlationId: randomUUID() }, created.id, new Date(Date.now() + 3_600_000));
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
  await page.getByRole("dialog", { name: "Adjust photo" }).getByRole("button", { name: "Use photo" }).click();
  await page.getByLabel("I confirm that I presented this notice to the person and recorded their acknowledgement.").check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("AWAITING_LEADER_REVIEW");
  expect((await db.employeeInvitationToken.findUniqueOrThrow({ where: { id: obsoleteLink.invitationId } })).revokedAt).not.toBeNull();
  await page.goto(`/en/company/${state.ownRegistrationId}#workers`);
  const workerRow = page.locator(".participant-row").filter({ hasText: "E2E Direct Employee" });
  await expect(workerRow.locator(".participant-avatar img")).toBeVisible();
  await workerRow.getByRole("button", { name: "View profile: E2E Direct Employee" }).click();
  const profile = page.getByRole("dialog", { name: "E2E Direct Employee" });
  await expect(profile).toContainText("Portuguese Citizen Card");
  await expect(profile).toContainText("DIRECT-6789");
  await expect(profile.getByRole("link", { name: "Edit details" })).toBeVisible();
  await profile.getByRole("button", { name: "Close", exact: true }).click();
  await expect(workerRow.getByRole("button", { name: "Approve person" })).toBeVisible();
  await workerRow.getByRole("button", { name: "Approve person" }).click();
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("LEADER_APPROVED");
});

test("manual worker drafts are discarded when empty and keep an entered name", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);

  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("button", { name: /Fill in details manually/ }).click();
  await expect(page).toHaveURL(/\/participants\/[0-9a-f-]+$/);
  const emptyId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Back to workers" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/company/${state.ownRegistrationId}$`));
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: emptyId } })).status).toBe("REMOVED");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByRole("button", { name: /Fill in details manually/ }).click();
  await expect(page).toHaveURL(/\/participants\/[0-9a-f-]+$/);
  const namedId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByLabel("Full name").fill("Saved Draft Worker");
  await page.getByRole("button", { name: "Back to workers" }).click();
  await expect(page.locator(".participant-row").filter({ hasText: "Saved Draft Worker" })).toBeVisible();
  await expect.poll(async () => db.eventParticipant.findUniqueOrThrow({ where: { id: namedId } })).toMatchObject({ status: "DRAFT", fullName: "Saved Draft Worker" });
  await db.eventParticipant.update({ where: { id: namedId }, data: { status: "REMOVED" } });
});

test("leader notices and admin destructive actions are explicit", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);
  const vehicleToggle = page.getByLabel("The company requires a vehicle pass");
  if (!await vehicleToggle.isChecked()) await vehicleToggle.check();
  await expect(page.getByText("The selected quantity is subject to approval.", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/company/${state.ownRegistrationId}/submission`);
  await expect(page.getByText("Synthetic data only", { exact: false })).toBeVisible();
  await expect(page.locator('input[name="dataProcessingNoticeVersion"]')).toHaveValue("test-v1");
  await expect(page.locator('input[name="dataProcessingNoticeHash"]')).toHaveValue(/^[a-f0-9]{64}$/);
  await expect(page.getByRole("checkbox")).toHaveAttribute("required", "");

  const f = await fixture(db);
  const participant = await db.eventParticipant.create({ data: { registrationId: f.registration.id, eventId: f.event.id, fullName: "Irreversible Action Worker", status: "LEADER_APPROVED" } });
  await db.companyEventRegistration.update({ where: { id: f.registration.id }, data: { status: "APPROVED" } });
  await clerk.signOut({ page });
  await clerk.signIn({ page, emailAddress: state.adminEmail });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/admin/people?eventId=${f.event.id}`);
  const personRow = page.locator("tbody tr").filter({ hasText: participant.fullName! });
  await personRow.getByRole("button", { name: "Delete person" }).click();
  const personDialog = page.getByRole("alertdialog", { name: "Permanently delete this person?" });
  await expect(personDialog.getByText("This action is irreversible.", { exact: false })).toBeVisible();
  await expect(personDialog.getByRole("button", { name: "Delete permanently" })).toBeVisible();
  await personDialog.getByRole("button", { name: "Cancel" }).last().click();

  await page.goto(`/en/admin/companies?eventId=${f.event.id}`);
  const companyRow = page.locator("tbody tr").filter({ hasText: f.company.name });
  await companyRow.getByRole("button", { name: "Delete company" }).click();
  const companyDialog = page.getByRole("alertdialog", { name: "Permanently delete this company?" });
  await expect(companyDialog.getByText("This action is irreversible", { exact: false })).toBeVisible();
  await companyDialog.getByRole("button", { name: "Cancel" }).last().click();

  const zone = await db.zone.create({ data: { name: `Delete option zone ${randomUUID()}` } });
  await page.goto(`/en/admin/setup/zones?eventId=${f.event.id}`);
  const zoneRow = page.locator(".setup-toggle-list form").filter({ hasText: zone.name });
  await zoneRow.getByRole("button", { name: "Delete", exact: true }).click();
  const zoneDialog = page.getByRole("alertdialog", { name: "Delete this zone?" });
  await expect(zoneDialog.getByText("This action is irreversible", { exact: false })).toBeVisible();
  await zoneDialog.getByRole("button", { name: "Cancel" }).last().click();
});

test("add-worker modal creates and copies a one-time employee link", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("button", { name: "Generate link" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add person" }).click();
  const modal = page.getByRole("dialog", { name: "Add worker" });
  await modal.getByRole("button", { name: /Share a secure link/ }).click();
  const link = page.getByRole("textbox", { name: "Link ready to share" });
  await expect(link).toHaveValue(/\/en\/onboarding\//);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Copied!", { exact: true })).toBeVisible();
  const created = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId, status: "AWAITING_EMPLOYEE", id: { not: state.workerParticipantId } }, orderBy: { createdAt: "desc" } });
  await page.getByRole("dialog", { name: "Link ready to share" }).getByRole("button", { name: "Close", exact: true }).click();
  const pendingRow = page.locator(".participant-row").filter({ hasText: "Not provided" }).last();
  await pendingRow.getByRole("button", { name: "View profile: Awaiting worker details" }).click();
  const pendingProfile = page.getByRole("dialog", { name: "Awaiting worker details" });
  await pendingProfile.getByRole("button", { name: "Remove person" }).click();
  await expect(pendingProfile.getByText("Remove this person?")).toBeVisible();
  await pendingProfile.getByRole("button", { name: "Yes, remove" }).click();
  await expect.poll(async () => (await db.eventParticipant.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("REMOVED");
  await expect(db.auditEvent.findFirst({ where: { entityId: created.id, action: "PARTICIPANT_REMOVED" } })).resolves.not.toBeNull();
});

test("leader submits an immutable version and AIA approves it", async ({ page }) => {
  const leader = await db.user.findFirstOrThrow({ where: { role: "COMPANY_LEADER", memberships: { some: { company: { name: state.ownCompany } } } } });
  await approveParticipant(db, { clerkUserId: leader.clerkUserId, correlationId: randomUUID() }, state.workerParticipantId);
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  await page.goto(`/en/company/${state.ownRegistrationId}/submission`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("heading", { name: "Final Submission" })).toBeVisible();
  const submissionUrl = page.url();
  await page.getByRole("button", { name: "View full summary" }).click();
  await expect(page.getByRole("dialog", { name: "Submission summary" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Submission summary" }).getByText(state.ownCompany)).toBeVisible();
  await page.getByRole("dialog", { name: "Submission summary" }).getByRole("button", { name: "Close", exact: true }).click();
  expect(page.url()).toBe(submissionUrl);
  await page.locator('input[name="dataProcessingAccepted"]').check();
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
  await page.getByText("Return for correction", { exact: true }).click();
  await expect(page.getByLabel("Reason category")).toBeVisible();
  await expect(page.getByLabel("Comment required for return or rejection")).toBeVisible();
  await page.getByText("Approve", { exact: true }).click();
  await expect(page.getByLabel("Reason category")).toHaveCount(0);
  await expect(page.getByText(/SHA-256/)).toHaveCount(0);
  await expect(page.getByText(/•••/)).toHaveCount(0);
  await page.getByRole("button", { name: /E2E Employee/ }).first().click();
  const personDialog = page.getByRole("dialog", { name: "E2E Employee" });
  await expect(personDialog).toContainText("E2E-12345");
  await personDialog.getByRole("button", { name: /Adjust photo:/ }).click();
  const adjustmentDialog = page.getByRole("dialog", { name: "Adjust photo for AIA" });
  await adjustmentDialog.getByRole("button", { name: "Adjust photo", exact: true }).click();
  const adminCropDialog = page.getByRole("dialog", { name: "Adjust photo", exact: true });
  await adminCropDialog.getByRole("button", { name: "Use photo" }).click();
  await expect(adminCropDialog).toBeHidden();
  await adjustmentDialog.getByRole("button", { name: "Save framing" }).click();
  await expect.poll(() => db.submissionPhotoAdjustment.count({ where: { submissionId: submission.id } })).toBe(1);
  await expect(page.getByText("Photo framing saved.")).toBeVisible();
  await expect(adjustmentDialog).toBeHidden();
  await page.reload();
  const submittedPersonCount = await page.locator(".admin-person-trigger").count();
  while (await page.locator(".admin-person-trigger").filter({ has: page.locator(".state-pending") }).count()) {
    await page.locator(".admin-person-trigger").filter({ has: page.locator(".state-pending") }).first().click();
    const pendingPersonDialog = page.locator(".admin-person-modal");
    await pendingPersonDialog.getByRole("button", { name: "Approve person", exact: true }).click();
    await expect(page.getByText("Person decision saved.")).toBeVisible();
    await page.reload();
  }
  await expect.poll(() => db.submissionParticipantReview.count({ where: { submissionId: submission.id, outcome: "APPROVED" } })).toBe(submittedPersonCount);
  await expect(page.getByRole("button", { name: "Confirm decision", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect.poll(async () => (await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).status).toBe("APPROVED");
});

test("F02 crafted photo edit after AIA approval is rejected before storage staging", async ({ page }) => {
  await page.goto("/en");
  await clerk.signIn({ page, emailAddress: state.leaderEmail });
  const person = await db.eventParticipant.findFirstOrThrow({ where: { registrationId: state.ownRegistrationId, fullName: "E2E Direct Employee" } });
  const before = await db.photoUpload.count({ where: { participantId: person.id } });
  const original = await page.request.get(`/api/participants/${person.id}/photo`);
  expect(original.status()).toBe(200);
  const bytes = await original.body();
  await page.goto(`/en/company/${state.ownRegistrationId}/participants/${person.id}`);
  await useLocalServerActionOrigin(page);
  await expect(page.getByRole("button", { name: "Save details" })).toBeDisabled();
  // A hostile authenticated caller can remove frontend locks; the server remains the boundary.
  await page.locator("fieldset.participant-form-fields").evaluate(element => { (element as unknown as { disabled: boolean }).disabled = false; });
  await page.locator("fieldset.participant-form-fields fieldset").evaluateAll(elements=>elements.forEach(element=>{(element as unknown as {disabled:boolean}).disabled=false;}));
  await page.getByLabel("Full name").fill("Unreviewed Synthetic Edit");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Photo", { exact: true }).setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
  await page.getByRole("dialog", { name: "Adjust photo" }).getByRole("button", { name: "Use photo" }).click();
  await page.getByRole("button", { name: "Save details" }).evaluate(element => { (element as unknown as { disabled: boolean }).disabled = false; });
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page).toHaveURL(/result=edit_locked/);
  expect(await db.photoUpload.count({ where: { participantId: person.id } })).toBe(before);
  expect(await db.eventParticipant.findUniqueOrThrow({ where: { id: person.id } })).toEqual(person);
  expect((await db.companyEventRegistration.findUniqueOrThrow({ where: { id: state.ownRegistrationId } })).status).toBe("APPROVED");
  const after = await page.request.get(`/api/participants/${person.id}/photo`);
  expect(after.status()).toBe(200);
  expect(await after.body()).toEqual(bytes);
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

test("Phase 2 internal XLSX template, preview, import, photographs, per-worker review and effective zone isolation", async ({page})=>{
  test.setTimeout(180_000);
  const admin=await db.user.findFirstOrThrow({where:{role:"ADMIN",clerkUserId:{in:createdClerkUserIds}}});
  const context={clerkUserId:admin.clerkUserId,correlationId:randomUUID()};
  const event=await db.event.create({data:{name:`Phase 2 Synthetic ${suffix}`,startDate:new Date("2030-06-01"),endDate:new Date("2030-06-03"),onboardingOpensAt:new Date("2025-01-01"),onboardingClosesAt:new Date("2030-05-31"),status:"ONBOARDING_OPEN"}});
  const zs=[];for(const name of ["Paddock","Media","Grandstand"]) {const z=await db.zone.create({data:{name:`${name} internal ${suffix}`}});await db.eventZone.create({data:{eventId:event.id,zoneId:z.id}});zs.push(z);}
  const role=await db.jobRole.create({data:{name:`Internal operations ${suffix}`}});
  await page.goto("/en");await clerk.signIn({page,emailAddress:state.adminEmail});await useLocalServerActionOrigin(page);
  await page.goto(`/en/admin/people?eventId=${event.id}`);await page.getByRole("link",{name:"Import Workers",exact:true}).click();
  await expect(page).toHaveURL(/\/en\/admin\/people\/import\?/);
  await expect(page.getByRole("heading",{name:"Import Workers",exact:true})).toBeVisible();
  await page.locator('select[name="eventId"]').selectOption(event.id);
  await page.getByRole("button",{name:"Select or create internal registration"}).click();
  await expect(page.getByRole("link",{name:"Download Excel template"})).toBeVisible();
  const registrationId=new URL(page.url()).searchParams.get("registrationId")!;
  const downloading=page.waitForEvent("download");await page.getByRole("link",{name:"Download Excel template"}).click();const download=await downloading;
  const workbookBytes=await readFile((await download.path())!);
  type Workbook={xlsx:{load:(b:Buffer)=>Promise<void>;writeBuffer:()=>Promise<Buffer>};getWorksheet:(n:string)=>{getRow:(n:number)=>{values:unknown[]}}};
  const Excel=createRequire(new URL("../../packages/domain/package.json",import.meta.url))("exceljs") as {Workbook:new()=>Workbook};
  const w=new Excel.Workbook();await w.xlsx.load(workbookBytes);
  for(let i=0;i<2;i++) w.getWorksheet("Workers").getRow(i+2).values=[`Synthetic internal ${i===0?"A":"B"} ${suffix}`,"1990-01-01","PASSPORT",`001${suffix}${i}`,"2035-01-01","+351912345678","PT","AIA",role.id,"2030-06-01",i===0?`${zs[0]!.id};${zs[1]!.id}`:zs[2]!.id,`staff-${i}.png`,`STAFF-${suffix}-${i}`];
  await page.getByLabel("Workers file").setInputFiles({name:"synthetic-staff.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:await w.xlsx.writeBuffer()});
  await page.getByRole("button",{name:"Validate and preview"}).click();await expect(page.getByRole("heading",{name:"Review before importing"})).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Validation completed");
  await expect(page.locator("tbody")).toContainText("Privacy notice");
  await expect(page.locator("tbody")).not.toContainText("Aviso de privacidade");
  await expect(page.locator(".admin-event-switcher")).toContainText(event.name);
  await expect(page.getByText("2 rows · 0 complete · 2 incomplete",{exact:false})).toBeVisible();
  await mkdir(".impeccable/review",{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:".impeccable/review/desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>{const surface=globalThis as unknown as {document:{documentElement:{scrollWidth:number}};innerWidth:number};return surface.document.documentElement.scrollWidth<=surface.innerWidth;})).toBe(true);await page.screenshot({path:".impeccable/review/mobile.png",fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel("I confirm creation of the indicated records.",{exact:false}).check();await page.getByRole("button",{name:"Confirm import",exact:true}).click();await expect(page.getByRole("status")).toContainText("2 created");
  await page.getByRole("link",{name:"Complete and review workers"}).click();
  const people=await db.eventParticipant.findMany({where:{registrationId},orderBy:{fullName:"asc"}});expect(people).toHaveLength(2);
  const photo=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  for(const person of people) {
    await page.goto(`/en/admin/people/internal/${registrationId}/${person.id}`);
    await page.getByLabel("Photo",{exact:true}).setInputFiles({name:person.photoReference!,mimeType:"image/png",buffer:photo});
    await page.getByRole("dialog",{name:"Adjust photo",exact:true}).getByRole("button",{name:"Use photo"}).click();
    await page.getByLabel("I confirm that I presented this notice to the person and recorded their acknowledgement.").check();await page.getByRole("button",{name:"Save data",exact:true}).click();
    await expect(page.getByRole("button",{name:"Mark ready for submission"})).toBeVisible();await page.getByRole("button",{name:"Mark ready for submission"}).click();
    await expect.poll(async()=>(await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}})).status).toBe("LEADER_APPROVED");
  }
  await page.goto(`/en/admin/people/internal/${registrationId}`);await page.locator('input[name="consent"]').check();await page.getByRole("button",{name:"Submit for AIA review",exact:true}).click();await expect(page).toHaveURL(/\/admin\/queue\//);
  while(await page.locator(".admin-person-trigger .state-pending").count()) {await page.locator(".admin-person-trigger").filter({has:page.locator(".state-pending")}).first().click();await expect(page.locator(".admin-person-modal")).toContainText("Individual zones");await page.locator(".admin-person-modal").getByRole("button",{name:"Approve person",exact:true}).click();await expect(page.getByText("Person decision saved.")).toBeVisible();await page.reload();}
  await page.getByRole("button",{name:"Confirm decision",exact:true}).click();await expect.poll(async()=>(await db.companyEventRegistration.findUniqueOrThrow({where:{id:registrationId}})).status).toBe("APPROVED");
  const key=parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY;
  expect((await workerEffectiveAccess(db,context,people[0]!.id,key)).effective.map(z=>z.id).sort()).toEqual([zs[0]!.id,zs[1]!.id].sort());expect((await workerEffectiveAccess(db,context,people[1]!.id,key)).effective.map(z=>z.id)).toEqual([zs[2]!.id]);
  await page.goto(`/en/admin/people/internal/${registrationId}/${people[1]!.id}?eventId=${event.id}`);for(const box of await page.locator('input[name="zoneIds"]:checked').all()) await box.uncheck();await page.locator(`input[name="zoneIds"][value="${zs[1]!.id}"]`).check();await page.getByLabel("Assignment/change reason").fill("Synthetic zone correction after approval");await page.getByRole("button",{name:"Save individual zones"}).click();
  await expect(page.getByText("No effective authorisation. AIA approval is required.")).toBeVisible();expect((await workerEffectiveAccess(db,context,people[1]!.id,key)).history[0]?.zones.map(z=>z.id)).toEqual([zs[2]!.id]);
  const newRegistration=(await import("../../packages/domain/src/index.ts")).ensureInternalRegistration;
  const parkalgar=await newRegistration(db,context,{eventId:event.id,organisation:"PARKALGAR"});
  w.getWorksheet("Workers").getRow(2).values=["Synthetic invalid","not-a-date","PASSPORT","001234","2035-01-01","+351912345678","PT","PARKALGAR",role.id,"2030-06-01",randomUUID(),"","BAD"];
  w.getWorksheet("Workers").getRow(3).values=["Synthetic incomplete","","","","","","","PARKALGAR","","","","","MISSING"];
  for(const language of ["en","pt"] as const) {
    await page.goto(`/${language}/admin/people/import?registrationId=${parkalgar.id}&eventId=${event.id}`);
    await page.getByLabel(language==="pt"?"Ficheiro de trabalhadores":"Workers file").setInputFiles({name:"invalid-synthetic.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:await w.xlsx.writeBuffer()});
    await page.getByRole("button",{name:language==="pt"?"Validar e pré-visualizar":"Validate and preview"}).click();await expect(page.getByRole("status")).toContainText(language==="pt"?"Validação concluída":"Validation completed");
    await expect(page.locator("tbody")).toContainText(language==="pt"?"Zonas desconhecidas, repetidas ou inativas":"Unknown, duplicate or inactive zones");
    await expect(page.locator("tbody")).toContainText(language==="pt"?"Aviso de privacidade":"Privacy notice");
    await expect(page.locator("tbody")).not.toContainText(language==="pt"?"Privacy notice":"Aviso de privacidade");
    await page.screenshot({path:`.impeccable/review/${language}-invalid.png`,fullPage:true});
  }
});

test("Phase 2 post-deadline company correction, request completion and non-draft Cancel",async({page})=>{
  test.setTimeout(120_000);
  const f=await fixture(db),leader=await db.user.findUniqueOrThrow({where:{clerkUserId:createdClerkUserIds[1]!}}),admin=await db.user.findUniqueOrThrow({where:{clerkUserId:createdClerkUserIds[0]!}});
  await db.companyLeaderMembership.update({where:{id:f.membership.id},data:{userId:leader.id}});
  const leaderActor={clerkUserId:leader.clerkUserId,correlationId:randomUUID()},adminActor={clerkUserId:admin.clerkUserId,correlationId:randomUUID()},key=parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY;
  const z=await db.zone.create({data:{name:"Post-deadline zone "+suffix}});await db.eventZone.create({data:{eventId:f.event.id,zoneId:z.id}});await configureRegistration(db,leaderActor,{registrationId:f.registration.id,expectedVersion:1,zoneIds:[z.id],vehicle:{required:false,requestedQuantity:0,justification:null}});
  const person=await readyPerson(db,f,"Synthetic correction worker",key),s=await submitCompanyRegistration(db,leaderActor,{registrationId:f.registration.id,expectedVersion:2,dataProcessingAccepted:true,dataProcessingNoticeVersion:"test-v1"},key);
  await reviewSubmissionParticipant(db,adminActor,{submissionId:s.id,participantId:person.id,outcome:"APPROVED"});await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()-1000)}});await reviewCompanySubmission(db,adminActor,{submissionId:s.id,expectedRegistrationVersion:3,action:"RETURN",reason:"VEHICLE_PASS",comment:"Please correct the vehicle request after the deadline."});
  await page.goto("/en");await clerk.signIn({page,emailAddress:state.leaderEmail});await useLocalServerActionOrigin(page);await page.goto(`/en/company/${f.registration.id}`);
  await expect(page.getByLabel("The company requires a vehicle pass")).toBeEnabled();await expect(page.locator('input[name="zoneIds"]')).toBeDisabled();await page.getByLabel("The company requires a vehicle pass").check();await page.locator('textarea[name="justification"]').fill("Synthetic vehicle correction");await page.getByRole("button",{name:"Save configuration"}).click();
  await expect.poll(async()=>(await db.vehiclePassRequest.findUniqueOrThrow({where:{registrationId:f.registration.id}})).required).toBe(true);
  const req=await createCompanyRequest(db,leaderActor,{registrationId:f.registration.id,targetParticipantId:person.id,reason:"Synthetic contact amendment",payload:{type:"EDIT_PERSON",scope:"CONTACT"}});await decideCompanyRequest(db,adminActor,{requestId:req.id,expectedVersion:1,decision:"APPROVE"});
  await page.goto(`/en/company/${f.registration.id}/participants/${person.id}`);await expect(page.getByLabel("Full name")).toBeDisabled();await expect(page.getByLabel("International mobile number")).toBeEnabled();
  const before=await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}});await page.getByRole("link",{name:"Cancel",exact:true}).click();expect((await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}})).version).toBe(before.version);
  await page.goto(`/en/company/${f.registration.id}/participants/${person.id}`);await page.getByLabel("International mobile number").fill("+351912345679");await page.getByRole("button",{name:"Save details"}).click();
  await expect.poll(async()=>(await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}})).mobileE164).toBe("+351912345679");
  await expect(page).toHaveURL(/result=saved/);
  await expect(page.getByRole("button",{name:"Approve person"})).toBeVisible();await page.getByRole("button",{name:"Approve person"}).click();
  await expect.poll(async()=>(await db.eventParticipant.findUniqueOrThrow({where:{id:person.id}})).status).toBe("LEADER_APPROVED");
  await expect(page).toHaveURL(new RegExp(`/en/company/${f.registration.id}\\?result=saved`));
  await page.goto(`/en/company/${f.registration.id}/submission`);await page.locator('input[name="dataProcessingAccepted"]').check();await page.getByRole("button",{name:"Submit to AIA"}).click();await expect.poll(async()=>(await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).status).toBe("AIA_REVIEW");expect(await db.companySubmission.count({where:{registrationId:f.registration.id}})).toBe(2);
});


test("Phase 3 approved notices, retention preview and worker notice language",async({page})=>{
  test.setTimeout(150000);
  const {approveEventRetentionPolicy,publishPrivacyNotice}=await import("../../packages/domain/src/index.ts");
  const adminContext={clerkUserId:createdClerkUserIds[0]!,correlationId:randomUUID()};
  const f=await fixture(db),leader=await db.user.findUniqueOrThrow({where:{clerkUserId:createdClerkUserIds[1]!}});
  const membership=await db.companyLeaderMembership.create({data:{companyId:f.company.id,userId:leader.id}});await db.companyEventRegistration.update({where:{id:f.registration.id},data:{primaryLeaderMembershipId:membership.id}});
  await approveEventRetentionPolicy(db,adminContext,{eventId:f.event.id,recordsEraseAfter:new Date("2020-01-01"),evidenceEraseAfter:new Date("2020-02-01"),communicationsEraseAfter:new Date("2020-01-01"),backupsEraseAfter:new Date("2035-01-01"),approvalReference:"SYNTHETIC-BROWSER-POLICY",approved:true,automaticPurge:false});
  await page.goto("/en");await clerk.signIn({page,emailAddress:state.adminEmail});await useLocalServerActionOrigin(page);
  await page.goto("/en/admin/operations?eventId="+f.event.id);
  await expect(page.getByRole("heading",{name:"Privacy and recovery",exact:true})).toBeVisible();await expect(page.getByText("Test configuration.",{exact:false})).toBeVisible();
  await page.getByText("Publish a new approved version",{exact:true}).click();const noticeForm=page.locator('form').filter({has:page.locator('input[value="notice"]')});
  await noticeForm.locator('input[name="noticeVersion"]').fill("SYNTHETIC-WORKER-1");await noticeForm.locator('textarea[name="textPt"]').fill("Aviso sintético para {event}. Apenas dados de teste, sem aprovação jurídica real.");await noticeForm.locator('textarea[name="textEn"]').fill("Synthetic notice for {event}. Test data only, without real legal approval.");await noticeForm.locator('input[name="reference"]').fill("SYNTHETIC-NOTICE-APPROVAL");await noticeForm.locator('input[name="approved"]').check();await noticeForm.getByRole("button",{name:"Publish version",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Operation saved."})).toBeVisible();
  await publishPrivacyNotice(db,adminContext,{eventId:f.event.id,kind:"LEADER",version:"SYNTHETIC-LEADER-1",textPt:"Declaração sintética para {event}. Apenas teste.",textEn:"Synthetic declaration for {event}. Test only.",approvalReference:"SYNTHETIC-LEADER-APPROVAL",approved:true});
  await page.locator('select[name="registrationId"]').selectOption(f.registration.id);await page.getByRole("button",{name:"Preview",exact:true}).click();await expect(page.getByText("Queue authorised erasure",{exact:true})).toBeVisible();
  await mkdir(".impeccable/review/phase3",{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({style:"nextjs-portal { display:none !important; }",path:".impeccable/review/phase3/desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({style:"nextjs-portal { display:none !important; }",path:".impeccable/review/phase3/mobile.png",fullPage:true});
  const environment=parseStorageEnv(process.env);const person=await readyPerson(db,f,"Synthetic privacy browser worker",environment.DOCUMENT_ENCRYPTION_KEY);const {createObjectStorage}=await import("../../packages/storage/src/object-storage.ts");const photoStore=createObjectStorage({endpoint:environment.MINIO_ENDPOINT,accessKey:environment.MINIO_ACCESS_KEY,secretKey:environment.MINIO_SECRET_KEY,bucket:environment.MINIO_PHOTOS_BUCKET,region:environment.MINIO_REGION});await photoStore.ensureBucket();const sharp=createRequire(new URL("../../packages/storage/package.json",import.meta.url))("sharp");await photoStore.putPhoto(person.photoObjectKey!,await sharp({create:{width:240,height:320,channels:3,background:"#707070"}}).jpeg().toBuffer());await db.eventParticipant.update({where:{id:person.id},data:{status:"DRAFT",privacyAcknowledgedAt:null,privacyNoticeVersion:null}});
  await clerk.signOut({page});await page.goto("/en");await clerk.signIn({page,emailAddress:state.leaderEmail});await useLocalServerActionOrigin(page);
  await page.goto("/en/company/"+f.registration.id+"/participants/"+person.id);await expect(page.getByText("Synthetic notice for",{exact:false})).toBeVisible();await expect(page.locator('input[name="privacyNoticeVersion"]')).toHaveValue("SYNTHETIC-WORKER-1");await expect(page.locator('input[name="privacyNoticeHash"]')).toHaveValue(/^[a-f0-9]{64}$/);await expect(page.locator('img[src^="/api/participants/"]')).toBeVisible();await page.locator('img[src^="/api/participants/"]').evaluate(async image=>{await (image as unknown as {decode:()=>Promise<void>}).decode();});
  await page.screenshot({style:"nextjs-portal { display:none !important; }",path:".impeccable/review/phase3/worker-en.png",fullPage:true});await page.goto("/pt/company/"+f.registration.id+"/participants/"+person.id);await expect(page.getByText("Aviso sintético para",{exact:false})).toBeVisible();await page.locator('img[src^="/api/participants/"]').evaluate(async image=>await (image as unknown as {decode:()=>Promise<void>}).decode());await page.screenshot({style:"nextjs-portal { display:none !important; }",path:".impeccable/review/phase3/worker-pt.png",fullPage:true});
});
