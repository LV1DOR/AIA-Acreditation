import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
import { queueBusinessEmail, queueBusinessEmails, type BusinessEmailPayload } from "./business-email.ts";
const schema = z.object({
  recipientUserId: z.uuid(), eventId: z.uuid(), registrationId: z.uuid(),
  type: z.enum(["REGISTRATION_UPDATED","SUBMISSION_RECEIVED","REQUEST_SUBMITTED","REQUEST_APPROVED","REQUEST_REJECTED","DEADLINE_REMINDER"]), deduplicationKey: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
}).strict();
export function notificationEmailTemplate(row: z.infer<typeof schema>): BusinessEmailPayload["template"] {
  if (row.type === "REQUEST_SUBMITTED" && row.parameters.priority === "URGENT" && row.parameters.requestType === "REPLACE_PERSON") return "URGENT_SUBSTITUTION";
  if (row.type !== "REGISTRATION_UPDATED") return row.type;
  const templates: Record<string, BusinessEmailPayload["template"]> = {
    REGISTRATION_REMOVED: "REGISTRATION_REMOVED", PARTICIPANT_REMOVED: "PARTICIPANT_REMOVED",
    APPROVED: "SUBMISSION_APPROVED", RETURNED_FOR_CORRECTION: "SUBMISSION_RETURNED", REJECTED: "SUBMISSION_REJECTED",
    VEHICLE_PASS_APPROVED: "VEHICLE_PASS_APPROVED", VEHICLE_PASS_REJECTED: "VEHICLE_PASS_REJECTED",
    MEMBERSHIP_REVOKED: "ACCESS_REMOVED", MEMBERSHIP_RESTORED: "ACCESS_RESTORED",
    PRIMARY_LEADER_CHANGED: "PRIMARY_LEADER_CHANGED", REGISTRATION_CONFIGURATION: "REGISTRATION_CONFIGURATION",
    APPROVAL_INVALIDATED: "APPROVAL_INVALIDATED",
  };
  return templates[String(row.parameters.updateKind)] ?? "STATUS_UPDATE";
}
async function emailPayload(tx: Tx, row: z.infer<typeof schema>): Promise<BusinessEmailPayload> {
  const r = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: row.registrationId },
    select: { eventId: true, company: { select: { name: true } }, event: { select: { name: true } } } });
  if (r.eventId !== row.eventId) throw new Error("NOTIFICATION_EVENT_SCOPE_MISMATCH");
  return { recipientUserId: row.recipientUserId, registrationId: row.registrationId,
    template: notificationEmailTemplate(row), companyName: r.company.name, eventName: r.event.name, path: "/portal" };
}
export async function recordNotification(tx: Tx, raw: z.input<typeof schema>) {
  const row = schema.parse(raw);
  const notification = await tx.notification.create({ data: row });
  await queueBusinessEmail(tx, "notification-email:" + row.deduplicationKey, await emailPayload(tx, row));
  return notification;
}
export async function recordNotifications(tx: Tx, raw: z.input<typeof schema>[]) {
  const rows = raw.map(row => schema.parse(row));
  const contexts = new Map<string, Promise<BusinessEmailPayload>>();
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000);
    await tx.notification.createMany({ data: batch });
    await queueBusinessEmails(tx, await Promise.all(batch.map(async row => {
      const key = row.registrationId + ":" + row.eventId;
      if (!contexts.has(key)) contexts.set(key, emailPayload(tx, row));
      const payload = { ...await contexts.get(key)!, recipientUserId: row.recipientUserId, template: notificationEmailTemplate(row) };
      return { deduplicationKey: "notification-email:" + row.deduplicationKey, payload };
    })));
  }
}
