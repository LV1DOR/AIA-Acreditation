import { z } from "zod";
import type { Tx } from "../shared/transaction.ts";
import type { ResolvedActor } from "../auth/authorization.ts";
const auditSchema = z.object({
  action: z.enum(["INTERNAL_IMPORTED", "INTERNAL_ZONES_UPDATED", "PARTICIPANT_REINSTATED", "MEMBERSHIP_REVOKED", "MEMBERSHIP_RESTORED", "PRIMARY_LEADER_CHANGED", "COMPANY_CREATED", "COMPANY_UPDATED", "COMPANY_DELETED", "EVENT_DELETED", "EVENT_CREATED", "EVENT_UPDATED", "ZONE_CREATED", "ZONE_UPDATED", "ZONE_DELETED", "JOB_ROLE_CREATED", "JOB_ROLE_UPDATED", "JOB_ROLE_DELETED", "EVENT_ZONE_ACTIVATED", "EVENT_ZONE_DEACTIVATED", "REGISTRATION_REMOVED", "REGISTRATION_CREATED", "REGISTRATION_LIMIT_UPDATED", "REGISTRATION_CONFIGURED", "LEADER_INVITED", "INVITATION_REVOKED", "INVITATION_ACCEPTED", "SESSION_ACCESS_GRANTED", "PARTICIPANT_CREATED", "EMPLOYEE_LINK_ISSUED", "EMPLOYEE_LINK_REVOKED", "PARTICIPANT_SUBMITTED", "PARTICIPANT_UPDATED", "PARTICIPANT_APPROVED", "PARTICIPANT_REMOVED", "PARTICIPANT_DELETED", "DUPLICATE_OVERRIDDEN", "SUBMISSION_CREATED", "SUBMISSION_APPROVED", "SUBMISSION_RETURNED", "SUBMISSION_REJECTED", "SUBMISSION_REOPENED", "APPROVAL_INVALIDATED", "SUBMISSION_PHOTO_ADJUSTED", "SUBMISSION_PARTICIPANT_APPROVED", "SUBMISSION_PARTICIPANT_RETURNED", "REQUEST_SUBMITTED", "REQUEST_CANCELLED", "REQUEST_APPROVED", "REQUEST_REJECTED", "VEHICLE_PASS_APPROVED", "VEHICLE_PASS_REJECTED"]),
  entityType: z.enum(["InternalImportBatch", "CompanyLeaderMembership", "Company", "Event", "Zone", "JobRole", "EventZone", "CompanyEventRegistration", "CompanySubmission", "SubmissionPhotoAdjustment", "SubmissionParticipantReview", "CompanyRequest", "VehiclePassRequest", "LeaderInvitation", "AuthSession", "EventParticipant", "EmployeeInvitationToken"]),
  entityId: z.uuid(), eventId: z.uuid().optional(), companyId: z.uuid().optional(),
  metadata: z.object({ zoneIds:z.array(z.uuid()).max(1000).optional(), previousZoneIds:z.array(z.uuid()).max(1000).optional(), reason: z.string().min(5).max(1000).optional(), version: z.number().int().positive().optional(), override: z.boolean().optional(),
    reasonCategory: z.enum(["ZONES","VEHICLE_PASS","PERSONNEL","PHOTO","DOCUMENT","WORK_DAYS","HEADCOUNT","DUPLICATE","OTHER"]).optional(),
    requestType: z.enum(["EXTRA_PERSONNEL","ADD_AFTER_DEADLINE","REMOVE_AFTER_DEADLINE","REPLACE_PERSON","EDIT_PERSON","CHANGE_WORK_DAYS","REPLACE_PHOTO","VEHICLE_PASS_CHANGE","ZONE_CHANGE","OTHER"]).optional(), priority:z.enum(["NORMAL","URGENT"]).optional(),
    inheritedApprovals: z.object({ fromSubmissionId: z.uuid(), participantCount: z.number().int().positive() }).optional()
  }).strict().default({}),
}).strict();
export async function appendAudit(tx: Tx, actor: ResolvedActor, raw: z.input<typeof auditSchema>) {
  const data = auditSchema.parse(raw);
  return tx.auditEvent.create({ data: { ...data, actorType: actor.role, actorUserId: actor.userId, correlationId: actor.correlationId } });
}

export async function appendEmployeeAudit(tx: Tx, correlationId: string, raw: z.input<typeof auditSchema>) {
  const data = auditSchema.parse(raw);
  return tx.auditEvent.create({ data: { ...data, actorType: "EMPLOYEE_LINK", actorUserId: null, correlationId } });
}
