import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { transaction } from "../shared/transaction.ts";
import { DomainError } from "../shared/errors.ts";
import { requireAdmin, resolveActor } from "./authorization.ts";
import { appendAudit } from "../audit/append.ts";
import { queueEncryptedEmail } from "../notifications/auth-email.ts";

const issueInput = z.object({
  registrationId: z.uuid(), email: z.email().transform(value => value.trim().toLowerCase()),
  expiresAt: z.date(),
  delivery: z.object({ appOrigin: z.url(), locale: z.enum(["pt", "en"]), encryptionKey: z.string().regex(/^[a-f0-9]{64}$/i) }).strict().optional(),
}).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function invitationAvailable(db: PrismaClient, rawToken: string) {
  if (!tokenSchema.safeParse(rawToken).success) return false;
  return Boolean(await db.leaderInvitation.findFirst({
    where: { tokenHash: hashToken(rawToken), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, registration: { company: { deactivatedAt: null } } },
    select: { id: true },
  }));
}
export async function issueLeaderInvitation(db: PrismaClient, context: ActorContext, raw: z.input<typeof issueInput>) {
  const input = issueInput.parse(raw);
  if (input.expiresAt <= new Date()) throw new DomainError("INVALID_INPUT");
  const token = randomBytes(32).toString("base64url");
  const invitation = await transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: input.registrationId }, include: { company: true } });
    if (!registration || registration.company.deactivatedAt) throw new DomainError("INVALID_INPUT");
    const created = await tx.leaderInvitation.create({ data: {
      registrationId: registration.id, companyId: registration.companyId,
      emailNormalized: input.email, tokenHash: hashToken(token), expiresAt: input.expiresAt, createdByUserId: actor.userId,
    } });
    await appendAudit(tx, actor, { action: "LEADER_INVITED", entityType: "LeaderInvitation", entityId: created.id, eventId: registration.eventId, companyId: registration.companyId });
    if (input.delivery) {
      const origin = new URL(input.delivery.appOrigin).origin;
      const link = `${origin}/api/invitations/start?locale=${input.delivery.locale}&token=${encodeURIComponent(token)}`;
      const companyName = registration.company.name;
      const safeCompany = companyName.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
      const portuguese = input.delivery.locale === "pt";
      await queueEncryptedEmail(tx, "LEADER_INVITATION_EMAIL", `leader-invitation:${created.id}`, {
        eventId: created.id,
        recipient: input.email,
        subject: portuguese ? `Convite AIA — ${companyName}` : `AIA invitation — ${companyName}`,
        text: portuguese ? `Foi convidado para gerir ${companyName} no portal AIA. Abra esta ligação antes de ${created.expiresAt.toISOString()}: ${link}` : `You were invited to manage ${companyName} in the AIA portal. Open this link before ${created.expiresAt.toISOString()}: ${link}`,
        html: portuguese ? `<p>Foi convidado para gerir <strong>${safeCompany}</strong> no portal AIA.</p><p><a href="${link}">Aceitar convite</a></p>` : `<p>You were invited to manage <strong>${safeCompany}</strong> in the AIA portal.</p><p><a href="${link}">Accept invitation</a></p>`,
      }, input.delivery.encryptionKey);
    }
    return { id: created.id, expiresAt: created.expiresAt };
  });
  // Returned once to the authorised caller and, when delivery is configured, queued only inside
  // the encrypted email payload. Never persist or log the raw token in plaintext.
  return { ...invitation, token };
}
export async function revokeLeaderInvitation(db: PrismaClient, context: ActorContext, invitationId: string) {
  const id = z.uuid().parse(invitationId);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const changed = await tx.leaderInvitation.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (changed.count !== 1) throw new DomainError("INVITATION_UNAVAILABLE");
    await appendAudit(tx, actor, { action: "INVITATION_REVOKED", entityType: "LeaderInvitation", entityId: id });
  });
}
const identityInput = z.object({
  clerkUserId: z.string().min(1).max(200),
  verifiedEmails: z.array(z.email()).max(100),
  correlationId: z.uuid(),
}).strict();
export type VerifiedInvitationIdentity = z.infer<typeof identityInput>;
export async function acceptLeaderInvitation(db: PrismaClient, rawIdentity: VerifiedInvitationIdentity, rawToken: string) {
  const identity = identityInput.parse(rawIdentity);
  const parsedToken = tokenSchema.safeParse(rawToken);
  if (!parsedToken.success) throw new DomainError("INVITATION_UNAVAILABLE");
  const tokenHash = hashToken(parsedToken.data);
  return transaction(db, async tx => {
    const now = new Date();
    const invitation = await tx.leaderInvitation.findUnique({ where: { tokenHash }, include: { registration: { include: { company: true } } } });
    if (!invitation || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now ||
      invitation.registration.company.deactivatedAt ||
      !identity.verifiedEmails.some(email => email.trim().toLowerCase() === invitation.emailNormalized)) {
      throw new DomainError("INVITATION_UNAVAILABLE");
    }
    const existing = await tx.user.findUnique({ where: { clerkUserId: identity.clerkUserId } });
    if (existing && (existing.disabledAt || existing.role !== "COMPANY_LEADER")) throw new DomainError("INVITATION_UNAVAILABLE");
    const user = existing ?? await tx.user.create({ data: { clerkUserId: identity.clerkUserId, role: "COMPANY_LEADER" } });
    const consumed = await tx.leaderInvitation.updateMany({
      where: { id: invitation.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, acceptedByUserId: user.id },
    });
    if (consumed.count !== 1) throw new DomainError("INVITATION_UNAVAILABLE");
    const membership = await tx.companyLeaderMembership.upsert({
      where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
      create: { companyId: invitation.companyId, userId: user.id },
      update: { revokedAt: null },
    });
    // An additional invitation never silently replaces an existing responsible leader.
    await tx.companyEventRegistration.updateMany({
      where: { id: invitation.registrationId, primaryLeaderMembershipId: null },
      data: { primaryLeaderMembershipId: membership.id, version: { increment: 1 } },
    });
    await appendAudit(tx, { userId: user.id, role: "COMPANY_LEADER", correlationId: identity.correlationId }, {
      action: "INVITATION_ACCEPTED", entityType: "LeaderInvitation", entityId: invitation.id,
      companyId: invitation.companyId, eventId: invitation.registration.eventId,
    });
    return { registrationId: invitation.registrationId };
  });
}
