import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { appendAudit, appendEmployeeAudit } from "../audit/append.ts";
import { requireAdmin, requireCompany, resolveActor } from "../auth/authorization.ts";
import { isPublishedEvent } from "../events/lifecycle.ts";
import { calendarDate, documentValidThroughEvent, toDate } from "../shared/calendar-date.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction, type Tx } from "../shared/transaction.ts";
import { assertLeaderCanEdit, hasReturnedParticipantCorrections } from "../submissions/edit-policy.ts";
import { protectDocumentNumber } from "./identity.ts";

const documentType = z.enum(["PASSPORT", "CARTAO_CIDADAO", "CARTAO_RESIDENCIA"]);
const details = z.object({
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth: calendarDate,
  documentType,
  documentNumber: z.string().trim().min(3).max(100).optional(),
  documentExpiryDate: calendarDate,
  mobile: z.string().trim().min(5).max(40),
  nationalityCode: z.string().trim().length(2).transform(value => value.toUpperCase()).refine(value => /^[A-Z]{2}$/.test(value)),
  jobRoleId: z.uuid(),
  workDays: z.array(calendarDate).min(1).max(366).refine(days => new Set(days).size === days.length),
}).strict();

type SensitiveKeys = { encryptionKey: string; fingerprintKey: string };
const activeStatuses = ["DRAFT", "AWAITING_EMPLOYEE", "AWAITING_LEADER_REVIEW", "LEADER_APPROVED", "DUPLICATE_REVIEW_REQUIRED"] as const;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function phone(value: string) {
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed?.isValid()) throw new DomainError("INVALID_INPUT");
  return parsed.number;
}

function validateSchedule(input: z.infer<typeof details>, event: { startDate: Date; endDate: Date }) {
  const start = event.startDate.toISOString().slice(0, 10), end = event.endDate.toISOString().slice(0, 10);
  if (!documentValidThroughEvent(input.documentExpiryDate, end) || input.workDays.some(day => day < start || day > end)) throw new DomainError("INVALID_INPUT");
}

async function duplicateExists(tx: Tx, participantId: string, eventId: string, fingerprint: string) {
  return (await tx.eventParticipant.count({ where: { eventId, documentNumberFingerprint: fingerprint, id: { not: participantId }, status: { in: [...activeStatuses] } } })) > 0;
}

async function replaceWorkDays(tx: Tx, participantId: string, days: string[]) {
  await tx.participantWorkDay.deleteMany({ where: { participantId } });
  await tx.participantWorkDay.createMany({ data: days.map(workDate => ({ participantId, workDate: toDate(workDate) })) });
}

async function assertParticipantLeaderCanEdit(tx: Tx, participant: { status:string; replacementRequestId: string | null; registration: Parameters<typeof assertLeaderCanEdit>[0] }) {
  if (participant.registration.status === "RETURNED_FOR_CORRECTION" && participant.status === "LEADER_APPROVED") throw new DomainError("EDIT_LOCKED");
  try {
    assertLeaderCanEdit(participant.registration, new Date());
    return;
  } catch (error) {
    if (!(error instanceof DomainError) || !["DEADLINE_CLOSED", "EDIT_LOCKED"].includes(error.code)) throw error;
  }
  if (participant.registration.status === "RETURNED_FOR_CORRECTION" && participant.status === "AWAITING_LEADER_REVIEW") return;
  if (!participant.replacementRequestId || participant.registration.status !== "RETURNED_FOR_CORRECTION") throw new DomainError("EDIT_LOCKED");
  const request = await tx.companyRequest.findFirst({ where:{ id:participant.replacementRequestId, status:"APPROVED", fulfilledBySubmissionId:null }, select:{ id:true } });
  if (!request) throw new DomainError("EDIT_LOCKED");
}

export async function createParticipant(db: PrismaClient, context: ActorContext, registrationId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: registrationId }, include: { event: true } });
    if (!registration) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, registration.companyId);
    assertLeaderCanEdit(registration, new Date());
    if (registration.status === "RETURNED_FOR_CORRECTION" && await hasReturnedParticipantCorrections(tx, registration.id)) throw new DomainError("EDIT_LOCKED");
    const count = await tx.eventParticipant.count({ where: { registrationId, status: { in: [...activeStatuses] } } });
    if (count >= registration.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    const participant = await tx.eventParticipant.create({ data: { registrationId, eventId: registration.eventId } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_CREATED", entityType: "EventParticipant", entityId: participant.id, eventId: registration.eventId, companyId: registration.companyId });
    return participant;
  });
}

export async function createParticipantWithInvitation(db: PrismaClient, context: ActorContext, registrationId: string, requestedExpiresAt: Date) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: registrationId } });
    if (!registration) throw new DomainError("FORBIDDEN");
    const event = await tx.event.findUniqueOrThrow({ where: { id: registration.eventId } });
    await requireCompany(tx, actor, registration.companyId);
    assertLeaderCanEdit({ ...registration, event }, new Date());
    if (registration.status === "RETURNED_FOR_CORRECTION" && await hasReturnedParticipantCorrections(tx, registration.id)) throw new DomainError("EDIT_LOCKED");
    const count = await tx.eventParticipant.count({ where: { registrationId, status: { in: [...activeStatuses] } } });
    if (count >= registration.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    const expiresAt = new Date(Math.min(requestedExpiresAt.getTime(), event.onboardingClosesAt.getTime()));
    if (expiresAt <= new Date()) throw new DomainError("INVALID_INPUT");
    const participant = await tx.eventParticipant.create({ data: { registrationId, eventId: registration.eventId, status: "AWAITING_EMPLOYEE" } });
    const token = randomBytes(32).toString("base64url");
    const invitation = await tx.employeeInvitationToken.create({ data: { participantId: participant.id, tokenHash: tokenHash(token), expiresAt, createdByUserId: actor.userId } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_CREATED", entityType: "EventParticipant", entityId: participant.id, eventId: registration.eventId, companyId: registration.companyId });
    await appendAudit(tx, actor, { action: "EMPLOYEE_LINK_ISSUED", entityType: "EmployeeInvitationToken", entityId: invitation.id, eventId: registration.eventId, companyId: registration.companyId });
    return { participantId: participant.id, invitationId: invitation.id, token, expiresAt };
  });
}

export async function issueEmployeeInvitation(db: PrismaClient, context: ActorContext, participantId: string, requestedExpiresAt: Date) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant || !activeStatuses.includes(participant.status as typeof activeStatuses[number])) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant);
    const expiresAt = new Date(Math.min(requestedExpiresAt.getTime(), participant.registration.event.onboardingClosesAt.getTime()));
    if (expiresAt <= new Date()) throw new DomainError("INVALID_INPUT");
    await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = randomBytes(32).toString("base64url");
    const invitation = await tx.employeeInvitationToken.create({ data: { participantId, tokenHash: tokenHash(token), expiresAt, createdByUserId: actor.userId } });
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "AWAITING_EMPLOYEE", version: { increment: 1 } } });
    await appendAudit(tx, actor, { action: "EMPLOYEE_LINK_ISSUED", entityType: "EmployeeInvitationToken", entityId: invitation.id, eventId: participant.eventId, companyId: participant.registration.companyId });
    return { token, expiresAt, invitationId: invitation.id };
  });
}

export async function revokeEmployeeInvitation(db: PrismaClient, context: ActorContext, invitationId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const invitation = await tx.employeeInvitationToken.findUnique({ where: { id: invitationId }, include: { participant: { include: { registration: true } } } });
    if (!invitation) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, invitation.participant.registration.companyId);
    const changed = await tx.employeeInvitationToken.updateMany({ where: { id: invitationId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!changed.count) throw new DomainError("TOKEN_UNAVAILABLE");
    await appendAudit(tx, actor, { action: "EMPLOYEE_LINK_REVOKED", entityType: "EmployeeInvitationToken", entityId: invitation.id, eventId: invitation.participant.eventId, companyId: invitation.participant.registration.companyId });
  });
}

export async function employeeInvitationView(db: PrismaClient, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new DomainError("TOKEN_UNAVAILABLE");
  const invitation = await db.employeeInvitationToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: {
    participant: { include: { registration: { include: { company: true, event: true } } } },
  } });
  const event = invitation?.participant.registration.event;
  if (!invitation || !event || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now || event.onboardingOpensAt > now || event.onboardingClosesAt <= now || !isPublishedEvent(event.status)) throw new DomainError("TOKEN_UNAVAILABLE");
  const jobRoles = await db.jobRole.findMany({ where: { deactivatedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  return { participantId: invitation.participantId, registrationId: invitation.participant.registrationId, eventId: event.id, companyName: invitation.participant.registration.company.name, eventName: event.name, startDate: event.startDate, endDate: event.endDate, jobRoles, expiresAt: invitation.expiresAt };
}

const employeeDetails = details.extend({ privacyAcknowledged: z.literal(true), privacyNoticeVersion: z.string().min(1).max(100) }).strict();
export async function submitEmployeeOnboarding(db: PrismaClient, rawToken: string, raw: z.input<typeof employeeDetails>, keys: SensitiveKeys, photoObjectKey: string, now = new Date()) {
  const input = employeeDetails.parse(raw);
  return transaction(db, async tx => {
    const invitation = await tx.employeeInvitationToken.findUnique({ where: { tokenHash: tokenHash(rawToken) }, include: { participant: { include: { registration: { include: { event: true } } } } } });
    const registration = invitation?.participant.registration, event = registration?.event;
    if (!invitation || !registration || !event || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now || event.onboardingOpensAt > now || event.onboardingClosesAt <= now || !isPublishedEvent(event.status)) throw new DomainError("TOKEN_UNAVAILABLE");
    validateSchedule(input, event);
    const role = await tx.jobRole.findFirst({ where: { id: input.jobRoleId, deactivatedAt: null } });
    if (!role) throw new DomainError("INVALID_INPUT");
    if (!input.documentNumber) throw new DomainError("INVALID_INPUT");
    const protectedNumber = protectDocumentNumber(input.documentType, input.documentNumber, invitation.participantId, keys.encryptionKey, keys.fingerprintKey);
    const duplicate = await duplicateExists(tx, invitation.participantId, event.id, protectedNumber.documentNumberFingerprint);
    const consumed = await tx.employeeInvitationToken.updateMany({ where: { id: invitation.id, usedAt: null, revokedAt: null }, data: { usedAt: now } });
    if (!consumed.count) throw new DomainError("TOKEN_UNAVAILABLE");
    await tx.eventParticipant.update({ where: { id: invitation.participantId }, data: {
      fullName: input.fullName, dateOfBirth: toDate(input.dateOfBirth), documentType: input.documentType, ...protectedNumber,
      documentExpiryDate: toDate(input.documentExpiryDate), mobileE164: phone(input.mobile), nationalityCode: input.nationalityCode,
      jobRoleId: input.jobRoleId, photoObjectKey, privacyNoticeVersion: input.privacyNoticeVersion, privacyAcknowledgedAt: now,
      status: duplicate ? "DUPLICATE_REVIEW_REQUIRED" : "AWAITING_LEADER_REVIEW", version: { increment: 1 },
    } });
    await replaceWorkDays(tx, invitation.participantId, input.workDays);
    await appendEmployeeAudit(tx, randomUUID(), { action: "PARTICIPANT_SUBMITTED", entityType: "EventParticipant", entityId: invitation.participantId, eventId: event.id, companyId: registration.companyId });
    return { participantId: invitation.participantId, duplicate };
  });
}

const leaderDetails = details.extend({
  privacyAcknowledged: z.boolean().optional(),
  privacyNoticeVersion: z.string().min(1).max(100).optional(),
}).strict().refine(value => !value.privacyAcknowledged || Boolean(value.privacyNoticeVersion));

export async function updateParticipantByLeader(db: PrismaClient, context: ActorContext, participantId: string, raw: z.input<typeof leaderDetails>, keys: SensitiveKeys, photoObjectKey?: string) {
  const input = leaderDetails.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant);
    validateSchedule(input, participant.registration.event);
    const role = await tx.jobRole.findFirst({ where: { id: input.jobRoleId, deactivatedAt: null } });
    if (!role) throw new DomainError("INVALID_INPUT");
    let protectedNumber: ReturnType<typeof protectDocumentNumber> | Record<string, never> = {};
    let fingerprint = participant.documentNumberFingerprint;
    if (input.documentNumber) {
      protectedNumber = protectDocumentNumber(input.documentType, input.documentNumber, participant.id, keys.encryptionKey, keys.fingerprintKey);
      fingerprint = protectedNumber.documentNumberFingerprint;
    }
    if (!fingerprint) throw new DomainError("INVALID_INPUT");
    const duplicate = await duplicateExists(tx, participant.id, participant.eventId, fingerprint);
    const hasPhoto = Boolean(photoObjectKey ?? participant.photoObjectKey);
    const ready = hasPhoto && Boolean(participant.privacyAcknowledgedAt || input.privacyAcknowledged);
    await tx.eventParticipant.update({ where: { id: participant.id }, data: {
      fullName: input.fullName, dateOfBirth: toDate(input.dateOfBirth), documentType: input.documentType, ...protectedNumber,
      documentExpiryDate: toDate(input.documentExpiryDate), mobileE164: phone(input.mobile), nationalityCode: input.nationalityCode,
      jobRoleId: input.jobRoleId, ...(photoObjectKey ? { photoObjectKey } : {}),
      ...(input.privacyAcknowledged ? { privacyAcknowledgedAt: new Date(), privacyNoticeVersion: input.privacyNoticeVersion } : {}),
      status: duplicate ? "DUPLICATE_REVIEW_REQUIRED" : ready ? "AWAITING_LEADER_REVIEW" : "DRAFT", version: { increment: 1 },
    } });
    await replaceWorkDays(tx, participant.id, input.workDays);
    await appendAudit(tx, actor, { action: "PARTICIPANT_UPDATED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
    return { duplicate };
  });
}

export async function approveParticipant(db: PrismaClient, context: ActorContext, participantId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } }, workDays: true } });
    if (!participant) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant);
    if (participant.status !== "AWAITING_LEADER_REVIEW" || !participant.photoObjectKey || !participant.privacyAcknowledgedAt || !participant.fullName || !participant.documentNumberFingerprint || !participant.documentExpiryDate || !participant.jobRoleId || !participant.mobileE164 || !participant.dateOfBirth || !participant.nationalityCode || !participant.workDays.length) throw new DomainError("INVALID_INPUT");
    if (!documentValidThroughEvent(participant.documentExpiryDate.toISOString().slice(0, 10), participant.registration.event.endDate.toISOString().slice(0, 10))) throw new DomainError("INVALID_INPUT");
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "LEADER_APPROVED", version: { increment: 1 } } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_APPROVED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
  });
}

export async function removeParticipant(db: PrismaClient, context: ActorContext, participantId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant || !activeStatuses.includes(participant.status as typeof activeStatuses[number])) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant);
    await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "REMOVED", version: { increment: 1 } } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_REMOVED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
  });
}

export async function overrideDuplicate(db: PrismaClient, context: ActorContext, participantId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context); requireAdmin(actor);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: true } });
    if (!participant || participant.status !== "DUPLICATE_REVIEW_REQUIRED") throw new DomainError("INVALID_INPUT");
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "AWAITING_LEADER_REVIEW", version: { increment: 1 } } });
    await appendAudit(tx, actor, { action: "DUPLICATE_OVERRIDDEN", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId, metadata: { override: true, reasonCategory: "DUPLICATE" } });
  });
}
