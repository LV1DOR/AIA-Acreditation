import { randomBytes } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { deliverNextAuthEmail, issueLeaderInvitation } from "../../packages/domain/src/index.ts";

afterAll(() => db.$disconnect());

it("queues an encrypted leader invitation and delivers its one-time link through SMTP transport", async () => {
  await db.outboxMessage.updateMany({
    where: { type: "LEADER_INVITATION_EMAIL", processedAt: null },
    data: { processedAt: new Date(), payload: {} },
  });
  const f = await fixture(db);
  const encryptionKey = randomBytes(32).toString("hex");
  const recipient = `phase3-${f.registration.id}@example.invalid`;
  const invitation = await issueLeaderInvitation(db, f.adminActor, {
    registrationId: f.registration.id,
    email: recipient,
    expiresAt: new Date(Date.now() + 60_000),
    delivery: { appOrigin: "https://acreditacao.example.invalid", locale: "en", encryptionKey },
  });

  const row = await db.outboxMessage.findFirstOrThrow({
    where: { type: "LEADER_INVITATION_EMAIL", processedAt: null },
  });
  expect(JSON.stringify(row.payload)).not.toContain(recipient);
  expect(JSON.stringify(row.payload)).not.toContain(invitation.token);

  let delivered: { to: string; text: string } | undefined;
  const transport = {
    send: async (message: { to: string; text: string }) => {
      delivered = message;
      return { provider: "smtp" as const, messageId: "phase3-synthetic" };
    },
    close: () => {},
  };
  expect(await deliverNextAuthEmail(db, transport, encryptionKey)).toBe("SENT");
  expect(delivered?.to).toBe(recipient);
  expect(delivered?.text).toContain(`/api/invitations/start?locale=en&token=${invitation.token}`);
  expect((await db.outboxMessage.findUniqueOrThrow({ where: { id: row.id } })).payload).toEqual({});
  expect(await db.auditEvent.count({ where: { entityId: row.id, action: "LEADER_INVITATION_EMAIL_SENT" } })).toBe(1);
});
