import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
import type { ResolvedActor } from "../auth/authorization.ts";
const auditSchema = z.object({
  action: z.enum(["COMPANY_CREATED", "COMPANY_UPDATED", "EVENT_CREATED", "EVENT_UPDATED", "ZONE_CREATED", "ZONE_UPDATED", "JOB_ROLE_CREATED", "JOB_ROLE_UPDATED", "EVENT_ZONE_ACTIVATED", "EVENT_ZONE_DEACTIVATED", "REGISTRATION_CREATED", "REGISTRATION_LIMIT_UPDATED", "REGISTRATION_CONFIGURED", "LEADER_INVITED", "INVITATION_REVOKED", "INVITATION_ACCEPTED", "SESSION_ACCESS_GRANTED"]),
  entityType: z.enum(["Company", "Event", "Zone", "JobRole", "EventZone", "CompanyEventRegistration", "LeaderInvitation", "AuthSession"]),
  entityId: z.uuid(), eventId: z.uuid().optional(), companyId: z.uuid().optional(),
  metadata: z.object({ version: z.number().int().positive().optional(), override: z.boolean().optional(),
    reasonCategory: z.enum(["ZONES","VEHICLE_PASS","PERSONNEL","PHOTO","DOCUMENT","WORK_DAYS","HEADCOUNT","DUPLICATE","OTHER"]).optional()
  }).strict().default({}),
}).strict();
export async function appendAudit(tx: Tx, actor: ResolvedActor, raw: z.input<typeof auditSchema>) {
  const data = auditSchema.parse(raw);
  return tx.auditEvent.create({ data: { ...data, actorType: actor.role, actorUserId: actor.userId, correlationId: actor.correlationId } });
}
