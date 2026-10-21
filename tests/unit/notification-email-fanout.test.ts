import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { recordNotification, recordNotifications, notificationEmailTemplate } from "../../packages/domain/src/notifications/record.ts";
import { queueBusinessEmail, queueBusinessEmails } from "../../packages/domain/src/notifications/business-email.ts";
vi.mock("../../packages/domain/src/notifications/business-email.ts", () => ({ queueBusinessEmail: vi.fn(async () => ({ queued: true })), queueBusinessEmails: vi.fn(async () => {}) }));
const id = { user: randomUUID(), event: randomUUID(), registration: randomUUID() };
const row = { recipientUserId: id.user, eventId: id.event, registrationId: id.registration, type: "REGISTRATION_UPDATED" as const, deduplicationKey: "synthetic-decision", parameters: { updateKind: "VEHICLE_PASS_REJECTED" } };
function client() {
  return { notification: { create: vi.fn(async () => ({ id: randomUUID() })), createMany: vi.fn(async () => ({ count: 2 })) },
    companyEventRegistration: { findUniqueOrThrow: vi.fn(async () => ({ eventId: id.event, company: { name: "Synthetic company" }, event: { name: "Synthetic event" } })) } };
}
beforeEach(() => vi.clearAllMocks());
it("queues the vehicle rejection email with its notification in the caller's transaction", async () => {
  const db = client();
  await recordNotification(db as unknown as PrismaClient, row);
  expect(db.notification.create).toHaveBeenCalledTimes(1);
  expect(queueBusinessEmail).toHaveBeenCalledWith(db, "notification-email:synthetic-decision", expect.objectContaining({ recipientUserId: id.user, registrationId: id.registration, template: "VEHICLE_PASS_REJECTED", path: "/portal" }));
});
it.each([
  ["APPROVED", "SUBMISSION_APPROVED"], ["REJECTED", "SUBMISSION_REJECTED"], ["RETURNED_FOR_CORRECTION", "SUBMISSION_RETURNED"],
  ["VEHICLE_PASS_APPROVED", "VEHICLE_PASS_APPROVED"], ["REGISTRATION_CONFIGURATION", "REGISTRATION_CONFIGURATION"],
  ["APPROVAL_INVALIDATED", "APPROVAL_INVALIDATED"], ["MEMBERSHIP_REVOKED", "ACCESS_REMOVED"], ["MEMBERSHIP_RESTORED", "ACCESS_RESTORED"], ["PRIMARY_LEADER_CHANGED", "PRIMARY_LEADER_CHANGED"], ["FUTURE_UPDATE", "STATUS_UPDATE"],
])("provides one appropriate email for update %s", (updateKind, template) => {
  expect(notificationEmailTemplate({ ...row, parameters: { updateKind } })).toBe(template);
});
it.each(["SUBMISSION_RECEIVED", "REQUEST_SUBMITTED", "REQUEST_APPROVED", "REQUEST_REJECTED", "DEADLINE_REMINDER"] as const)("emails notification type %s", type => {
  expect(notificationEmailTemplate({ ...row, type, parameters: {} })).toBe(type);
});
it("keeps urgent replacements prominent without a second administrative email", () => {
  expect(notificationEmailTemplate({ ...row, type: "REQUEST_SUBMITTED", parameters: { requestType: "REPLACE_PERSON", priority: "URGENT" } })).toBe("URGENT_SUBSTITUTION");
});
it("batch emails retain distinct recipients and deterministic deduplication keys", async () => {
  const db = client(), other = randomUUID();
  await recordNotifications(db as unknown as PrismaClient, [row, { ...row, recipientUserId: other, deduplicationKey: "synthetic-other" }]);
  expect(queueBusinessEmails).toHaveBeenCalledWith(db, [
    expect.objectContaining({ deduplicationKey: "notification-email:synthetic-decision", payload: expect.objectContaining({ recipientUserId: id.user }) }),
    expect.objectContaining({ deduplicationKey: "notification-email:synthetic-other", payload: expect.objectContaining({ recipientUserId: other }) }),
  ]);
  expect(db.companyEventRegistration.findUniqueOrThrow).toHaveBeenCalledTimes(1);
});
it("refuses an event/registration mismatch rather than emailing another event's context", async () => {
  const db = client();
  await expect(recordNotification(db as unknown as PrismaClient, { ...row, eventId: randomUUID() })).rejects.toThrow("NOTIFICATION_EVENT_SCOPE_MISMATCH");
  expect(queueBusinessEmail).not.toHaveBeenCalled();
});
it("propagates enqueue failure so the enclosing domain transaction cannot commit only the notification", async () => {
  const db = client(); vi.mocked(queueBusinessEmail).mockRejectedValueOnce(new Error("SYNTHETIC_OUTBOX_FAILURE"));
  await expect(recordNotification(db as unknown as PrismaClient, row)).rejects.toThrow("SYNTHETIC_OUTBOX_FAILURE");
});
