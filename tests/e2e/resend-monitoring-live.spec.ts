import { mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { Webhook } from "standardwebhooks";
import { createDatabase } from "../../packages/database/src/index.ts";
import { fixture } from "../fixtures/foundation.ts";

const key = process.env.CLERK_SECRET_KEY, url = process.env.TEST_DATABASE_URL;
if (!key?.startsWith("sk_test_") || !url) throw new Error("SYNTHETIC_CLERK_CONFIGURATION_REQUIRED");
const target = new URL(url);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "16432" || target.pathname !== "/aia_acreditacao_test") throw new Error("ISOLATED_DATABASE_REQUIRED");
const db = createDatabase(url), api = createClerkClient({ secretKey: key });
const suffix = randomUUID().slice(0, 8), recipient = `synthetic-email-investigation-${suffix}@example.invalid`;
const pageRecipient = `synthetic-pages-${suffix}@example.invalid`;
const adminEmail = `aia-email-admin+clerk_test_${suffix}@example.com`, leaderEmail = `aia-email-leader+clerk_test_${suffix}@example.com`;
const clerkUsers: string[] = [];
let messageId: string, bouncedMessageId: string;
const smtpDiagnostic="smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please try550-5.1.1 double-checking the recipient's email address for typos or550-5.1.1 unnecessary spaces. For more information, go to550 5.1.1 https://support.google.com/mail/?p=NoSuchUser 5b1f17b1804b1-4b2a96071a0si103432225e9.3 - gsmtp";
test.beforeAll(async () => {
  const f = await fixture(db);
  for (const [address, user] of [[adminEmail, f.admin], [leaderEmail, f.leader]] as const) {
    const identity = await api.users.createUser({ emailAddress: [address], skipPasswordRequirement: true, skipLegalChecks: true });
    clerkUsers.push(identity.id);
    await db.user.update({ where: { id: user.id }, data: { clerkUserId: identity.id } });
  }
  const outbox = await db.outboxMessage.create({ data: { deduplicationKey: `synthetic-email-ui:${suffix}`, type: "BUSINESS_EMAIL", payload: {}, processedAt: new Date(), registrationId: f.registration.id, eventId: f.event.id } });
  const now = new Date(), sent = new Date(now.getTime() - 300000), delayed = new Date(now.getTime() - 120000);
  const resendId = randomUUID(), secondId = randomUUID();
  const message = await db.emailDelivery.create({ data: { outboxMessageId: outbox.id, recipients: [recipient], subject: "Synthetic AIA — Submission approved", sender: "notificacoes@notify.joinaia.pt", senderDomain: "notify.joinaia.pt", provider: "resend", resendEmailId: resendId, status: "SENT", providerStatus: "DELIVERED", providerStatusAt: now, deliveredAt: now, sentAt: sent, category: "SUBMISSION_APPROVED", companyId: f.company.id, eventId: f.event.id, attempts: 2 } });
  await db.emailProviderIdentity.createMany({ data: [resendId, secondId].map(id => ({ idHash: createHash("sha256").update(id).digest("hex"), resendEmailId: id, emailDeliveryId: message.id })) });
  messageId = message.id;
  await db.emailDeliveryEvent.createMany({ data: [["email.sent", sent, resendId], ["email.delivery_delayed", delayed, resendId], ["email.sent", new Date(now.getTime() - 60000), secondId], ["email.delivered", now, secondId]].map(([type, occurredAt, providerId]) => ({ emailDeliveryId: message.id, resendEmailId: providerId as string, svixId: `msg_synthetic_${randomUUID()}`, payloadDigest: "a".repeat(64), type: type as string, occurredAt: occurredAt as Date })) });
  const bounceId=randomUUID();
  const bounced=await db.emailDelivery.create({data:{recipients:[`synthetic-missing-${suffix}@example.invalid`],subject:"Convite AIA — Synthetic company",sender:"notificacoes@notify.joinaia.pt",senderDomain:"notify.joinaia.pt",provider:"resend",resendEmailId:bounceId,status:"SENT",providerStatus:"BOUNCED",sentAt:sent,providerStatusAt:now}});
  bouncedMessageId=bounced.id;
  await db.emailProviderIdentity.create({data:{idHash:createHash("sha256").update(bounceId).digest("hex"),resendEmailId:bounceId,emailDeliveryId:bounced.id}});
  await db.emailDeliveryEvent.createMany({data:[{emailDeliveryId:bounced.id,resendEmailId:bounceId,svixId:`msg_synthetic_${randomUUID()}`,payloadDigest:"a".repeat(64),type:"email.sent",occurredAt:sent},{emailDeliveryId:bounced.id,resendEmailId:bounceId,svixId:`msg_synthetic_${randomUUID()}`,payloadDigest:"b".repeat(64),type:"email.bounced",occurredAt:now,reasonCode:"RECIPIENT_NOT_FOUND",providerMessage:"The recipient address does not exist.",smtpResponse:smtpDiagnostic}]});
  await mkdir(".impeccable/review/resend-monitoring", { recursive: true });
  await db.emailDelivery.createMany({ data: Array.from({ length: 31 }, (_, index) => ({ recipients: [pageRecipient], subject: `Convite AIA — Synthetic company ${String(index + 1).padStart(2, "0")}`, provider: "resend", sender: "notificacoes@notify.joinaia.pt", senderDomain: "notify.joinaia.pt", status: "SENT", providerStatus: ["DELIVERED", "BOUNCED", "DELIVERY_DELAYED", "SENT"][index % 4], sentAt: new Date(now.getTime() - index * 60000), createdAt: new Date(now.getTime() - index * 60000) })) });
});
test.afterAll(async () => {
  for (const id of clerkUsers) await api.users.deleteUser(id);
  await db.$disconnect();
});

test("ADMIN can investigate full recipients, filter, inspect timelines and read both locales on desktop/mobile", async ({ page }) => {
  const capture = async (name: string) => {
    await page.evaluate(() => (globalThis as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `.impeccable/review/resend-monitoring/${name}.png`, fullPage: true, caret: "initial", style: "nextjs-portal { display:none !important; }" });
  };
  // This server has Clerk configured; the provider request still has no browser session or Origin.
  const webhookBody = JSON.stringify({ type: "email.opened", data: {} }), receipt = "msg_public_live_probe", timestamp = new Date();
  const webhookSecret = "whsec_" + Buffer.from("synthetic-playwright-resend-only").toString("base64");
  expect((await page.request.post("/api/webhooks/resend", { data: webhookBody, maxRedirects: 0, headers: { "svix-id": receipt, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "svix-signature": new Webhook(webhookSecret).sign(receipt, timestamp, webhookBody) } })).status()).toBe(204);
  await page.goto("/en/sign-in"); await clerk.signIn({ page, emailAddress: adminEmail });
  await page.goto(`/en/admin/emails?q=${recipient}`);
  await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: recipient, exact: true })).toBeVisible();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toHaveCount(0);
  await expect(page.getByText("About email tracking", { exact: true })).toHaveCount(0);
  await page.getByRole("searchbox").fill(`synthetic-email-investigatoin-${suffix}`);
  await expect(page).toHaveURL(/investigatoin/);
  await expect(page.getByRole("link", { name: recipient, exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("definitely-no-matching-message-12345");
  await expect(page.getByRole("heading", { name: "No emails found", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill(`synthetic-email-investigation-${suffix}`);
  await expect(page.getByRole("link", { name: recipient, exact: true })).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("DELIVERED");
  await expect(page).toHaveURL(/status=DELIVERED/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByText("Delivered means", { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("en-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  await capture("en-mobile");
  await page.goto(`/en/admin/emails/${messageId}`);
  await expect(page.getByRole("heading", { name: "Email events" })).toBeVisible();
  await expect(page.locator(".emails-timeline li")).toHaveCount(4);
  await expect(page.locator('[data-slot="timeline-date"]').first()).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(page.locator('[data-slot="timeline-date"]').first()).toHaveAttribute("datetime", /T.*Z$/);
  await expect(page.locator(".email-event-success .email-event-indicator")).toHaveCount(1);
  await expect(page.locator(".email-event-warning .email-event-indicator")).toHaveCount(1);
  await page.getByText("Additional information",{exact:true}).click();
  await expect(page.getByText("This notification has multiple provider messages", { exact: false })).toBeVisible();
  await page.getByText("Additional information",{exact:true}).click();
  await expect(page.getByRole("button", { name: /resend|retry|delete/i })).toHaveCount(0);
  await page.goto(`/en/admin/emails/${bouncedMessageId}`);
  await expect(page.getByRole("heading",{name:"Recipient not found",exact:true}).first()).toBeVisible();
  await page.locator(".emails-timeline li").first().getByText("Technical details",{exact:true}).click();
  await expect(page.locator(".emails-technical pre").last()).toHaveText(smtpDiagnostic);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth",390);
  await capture("detail-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture("detail-desktop");
  await page.goto(`/pt/admin/emails?q=${recipient}`);
  await expect(page.getByText("Entregue significa", { exact: false })).toBeVisible();
  await expect(page.getByRole("columnheader",{name:"Assunto",exact:true})).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Synthetic AIA — Submission approved");
  await capture("pt-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  await capture("pt-mobile");
  const apiRead = await page.request.get(`/api/admin/emails/${messageId}`);
  expect(apiRead.status()).toBe(200);
  expect(await apiRead.text()).toContain(recipient);
});

test("company leaders cannot access monitoring pages or APIs", async ({ page }) => {
  await page.goto("/en/sign-in"); await clerk.signIn({ page, emailAddress: leaderEmail });
  await page.goto("/en/admin/emails");
  expect(new URL(page.url()).pathname).not.toBe("/en/admin/emails");
  await expect(page.locator(".emails-page")).toHaveCount(0);
  expect((await page.request.get("/api/admin/emails")).status()).toBe(403);
  expect((await page.request.get(`/api/admin/emails/${messageId}`)).status()).toBe(403);
});

test("15-message pages navigate both ways and fit the desktop viewport, with bounded mobile overflow", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/en/sign-in"); await clerk.signIn({ page, emailAddress: adminEmail });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/en/admin/emails?q=${pageRecipient}`);
  await expect(page.locator("tbody tr")).toHaveCount(15);
  await expect(page.locator("tbody")).toContainText("Synthetic company 01");
  await expect(page.getByRole("link", { name: "Newer messages", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Older messages", exact: true })).toHaveAttribute("href", /cursor=.*direction=older/);
  await page.getByRole("link", { name: "Older messages", exact: true }).click();
  await expect(page).toHaveURL(/cursor=.*direction=older/);
  await expect(page.locator("tbody")).toContainText("Synthetic company 16");
  await expect(page.locator("tbody tr")).toHaveCount(15);
  await page.getByRole("link", { name: "Older messages", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Synthetic company 31");
  await expect(page.getByRole("link", { name: "Older messages", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Newer messages", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("Synthetic company 16");
  await expect(page.locator("tbody tr")).toHaveCount(15);
  await page.getByRole("link", { name: "Newer messages", exact: true }).click();
  await expect(page.locator("tbody")).toContainText("Synthetic company 01");
  const capture = async (name: string) => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `.impeccable/review/resend-monitoring/${name}.png`, fullPage: true, style: "nextjs-portal { display:none !important; }" });
  };
  await expect(page.getByText("15 emails per page", { exact: true })).toHaveCount(0);
  for (const viewport of [{ width: 1440, height: 1400 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("html")).toHaveJSProperty("scrollHeight", viewport.height);
    await expect.poll(async () => {
      const firstRow = await page.locator("tbody tr").first().boundingBox(), lastRow = await page.locator("tbody tr").last().boundingBox(), region = await page.locator(".table-scroll").boundingBox();
      return firstRow && lastRow && region ? { firstVisible: firstRow.y >= region.y, overflow: Math.max(0, Math.ceil(lastRow.y + lastRow.height - region.y - region.height - 1)), fillsTable: region.y + region.height - lastRow.y - lastRow.height < 17 } : null;
    }, { message: `All 15 rows fill the table at ${viewport.width}×${viewport.height}` }).toEqual({ firstVisible: true, overflow: 0, fillsTable: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await capture("en-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("html")).toHaveJSProperty("scrollHeight", 844);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 390);
  await expect(page.getByRole("navigation", { name: "Email pagination", exact: true })).toBeInViewport();
  await capture("en-mobile");
  await page.goto(`/pt/admin/emails?q=${pageRecipient}`);
  await expect(page.locator("tbody tr")).toHaveCount(15, { timeout: 30_000 });
  await page.setViewportSize({ width: 1440, height: 900 }); await capture("pt-desktop");
  await page.setViewportSize({ width: 390, height: 844 }); await capture("pt-mobile");
});
