import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
const schema = z.object({
  recipientUserId: z.uuid(), eventId: z.uuid(), registrationId: z.uuid(),
  type: z.enum(["REGISTRATION_UPDATED","SUBMISSION_RECEIVED","REQUEST_SUBMITTED","REQUEST_APPROVED","REQUEST_REJECTED","DEADLINE_REMINDER"]), deduplicationKey: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
}).strict();
export async function recordNotification(tx: Tx, raw: z.input<typeof schema>) {
  return tx.notification.create({ data: schema.parse(raw) });
}
