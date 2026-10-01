import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { recordNotification } from "../notifications/record.ts";

const decisionInput = z.object({ vehiclePassId: z.uuid(), expectedVersion: z.number().int().positive(), decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().trim().max(2000).optional() }).strict();

export async function decideVehiclePass(db: PrismaClient, context: ActorContext, raw: z.input<typeof decisionInput>) {
  const input = decisionInput.parse(raw);
  if (input.decision === "REJECT" && (!input.comment || input.comment.length < 5)) throw new DomainError("INVALID_INPUT");
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    requireAdmin(actor);
    const request = await tx.vehiclePassRequest.findUnique({
      where: { id: input.vehiclePassId },
      include: { registration: { select: { id: true, eventId: true, companyId: true, status: true, primaryLeader: { select: { userId: true, revokedAt: true } }, submissions: { orderBy: { version: "desc" }, take: 1, select: { id: true } } } } },
    });
    if (!request || !request.required || request.requestedQuantity < 1) throw new DomainError("INVALID_INPUT");
    if (request.version !== input.expectedVersion || request.approvedQuantity !== null) throw new DomainError("STALE_WRITE");
    if (!["AIA_REVIEW", "APPROVED"].includes(request.registration.status) || !request.registration.submissions.length) throw new DomainError("INVALID_TRANSITION");

    const approvedQuantity = input.decision === "APPROVE" ? request.requestedQuantity : 0;
    const decidedAt = new Date();
    const changed = await tx.vehiclePassRequest.updateMany({
      where: { id: request.id, version: input.expectedVersion, approvedQuantity: null },
      data: { approvedQuantity, decisionComment: input.decision === "REJECT" ? input.comment : null, decidedAt, decidedByUserId: actor.userId, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new DomainError("STALE_WRITE");
    const action = input.decision === "APPROVE" ? "VEHICLE_PASS_APPROVED" : "VEHICLE_PASS_REJECTED";
    await appendAudit(tx, actor, { action, entityType: "VehiclePassRequest", entityId: request.id, eventId: request.registration.eventId, companyId: request.registration.companyId, metadata: { version: input.expectedVersion + 1 } });
    const key = `vehicle:${request.id}:${input.expectedVersion + 1}`;
    await enqueueInvalidation(tx, key, { entityId: request.id, eventId: request.registration.eventId, version: input.expectedVersion + 1 });
    const leader = request.registration.primaryLeader;
    if (leader && !leader.revokedAt) await recordNotification(tx, {
      recipientUserId: leader.userId, eventId: request.registration.eventId, registrationId: request.registration.id,
      type: "REGISTRATION_UPDATED", deduplicationKey: key,
      parameters: { updateKind: action, approvedQuantity },
    });
    return { id: request.id, approvedQuantity, version: input.expectedVersion + 1 };
  });
}
