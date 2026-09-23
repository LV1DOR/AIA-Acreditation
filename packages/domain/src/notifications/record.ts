import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
const schema = z.object({
  recipientUserId: z.uuid(), eventId: z.uuid(), registrationId: z.uuid(),
  type: z.literal("REGISTRATION_UPDATED"), deduplicationKey: z.string().min(1).max(200)
}).strict();
export async function recordNotification(tx: Tx, raw: z.input<typeof schema>) {
  return tx.notification.create({ data: { ...schema.parse(raw), parameters: {} } });
}

