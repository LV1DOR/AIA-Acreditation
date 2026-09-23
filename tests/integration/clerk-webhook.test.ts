import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { db } from "./database.ts";

const previous = {
  databaseUrl: process.env.DATABASE_URL,
  signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
  encryptionKey: process.env.AUTH_EMAIL_ENCRYPTION_KEY,
};
const signingSecret = "whsec_" + randomBytes(32).toString("base64");
const encryptionKey = randomBytes(32).toString("hex");
let post: (request: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = signingSecret;
  process.env.AUTH_EMAIL_ENCRYPTION_KEY = encryptionKey;
  ({ POST: post } = await import("../../apps/web/src/app/api/webhooks/clerk/route.ts"));
});

afterAll(async () => {
  if (previous.databaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.databaseUrl;
  if (previous.signingSecret === undefined) delete process.env.CLERK_WEBHOOK_SIGNING_SECRET; else process.env.CLERK_WEBHOOK_SIGNING_SECRET = previous.signingSecret;
  if (previous.encryptionKey === undefined) delete process.env.AUTH_EMAIL_ENCRYPTION_KEY; else process.env.AUTH_EMAIL_ENCRYPTION_KEY = previous.encryptionKey;
  await db.$disconnect();
});

function signedRequest(body: string, valid = true) {
  const id = "msg_" + randomUUID(), timestamp = new Date();
  const signature = new Webhook(signingSecret).sign(id, timestamp, body);
  return new Request("http://127.0.0.1:3100/api/webhooks/clerk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": valid ? signature : signature.replace(/.$/, signature.endsWith("A") ? "B" : "A"),
    },
    body,
  });
}

it("accepts only a valid signed email.created event and persists an encrypted deduplicated payload", async () => {
  const eventId = "ema_" + randomUUID();
  const body = JSON.stringify({
    type: "email.created",
    data: {
      id: eventId,
      delivered_by_clerk: false,
      to_email_address: "synthetic-clerk-webhook@example.invalid",
      subject: "Synthetic Clerk authentication",
      body_plain: "SYNTHETIC_CLERK_CODE_424242",
      body: "<p>SYNTHETIC_CLERK_CODE_424242</p>",
    },
  });
  expect((await post(signedRequest(body, false))).status).toBe(400);
  expect((await post(signedRequest(body))).status).toBe(204);
  expect((await post(signedRequest(body))).status).toBe(204);
  const deduplicationKey = "clerk-email:" + createHash("sha256").update(eventId).digest("hex");
  const rows = await db.outboxMessage.findMany({ where: { deduplicationKey } });
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows[0]?.payload)).not.toContain("SYNTHETIC_CLERK_CODE_424242");
  expect(JSON.stringify(rows[0]?.payload)).not.toContain("synthetic-clerk-webhook@example.invalid");
  await db.outboxMessage.update({ where: { id: rows[0]!.id }, data: { processedAt: new Date(), payload: {} } });
});

it("rejects an oversized Clerk webhook before signature verification", async () => {
  const response = await post(new Request("http://127.0.0.1:3100/api/webhooks/clerk", {
    method: "POST",
    headers: { "content-length": "1000001" },
    body: "x",
  }));
  expect(response.status).toBe(413);
});
