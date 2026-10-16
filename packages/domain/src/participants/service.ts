import { assertRegistrationNotErasing, recordPrivacyAcknowledgement } from "../privacy/notices.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { appendAudit, appendEmployeeAudit } from "../audit/append.ts";
import { assertCompanyActive, requireAdmin, requireCompany, resolveActor } from "../auth/authorization.ts";
import { adoptPhotoUpload } from "./photo-lifecycle.ts";
import { validateParticipantEligibility } from "../submissions/eligibility.ts";
import { isPublishedEvent } from "../events/lifecycle.ts";
import { calendarDate, documentValidThroughEvent, toDate } from "../shared/calendar-date.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction, type Tx } from "../shared/transaction.ts";
import { participantCapabilities, registrationCapabilities } from "../submissions/capabilities.ts";
import { protectDocumentNumber, revealDocumentNumber, normalizeDocumentNumber } from "./identity.ts";
import { normalizePhoneNumber } from "./phone.ts";

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

function validateSchedule(input: z.infer<typeof details>, event: { startDate: Date; endDate: Date }) {
  const start = event.startDate.toISOString().slice(0, 10), end = event.endDate.toISOString().slice(0, 10);
  if (toDate(input.dateOfBirth)>new Date() || !documentValidThroughEvent(input.documentExpiryDate, end) || input.workDays.some(day => day < start || day > end)) throw new DomainError("INVALID_INPUT");
}

async function duplicateExists(tx: Tx, participantId: string, eventId: string, fingerprint: string) {
  return (await tx.eventParticipant.count({ where: { eventId, documentNumberFingerprint: fingerprint, id: { not: participantId }, status: { in: [...activeStatuses] } } })) > 0;
}

async function replaceWorkDays(tx: Tx, participantId: string, days: string[]) {
  await tx.participantWorkDay.deleteMany({ where: { participantId } });
  await tx.participantWorkDay.createMany({ data: days.map(workDate => ({ participantId, workDate: toDate(workDate) })) });
}

export async function assertParticipantLeaderCanEdit(tx: Tx, participant: { id:string }, role: "ADMIN" | "COMPANY_LEADER" = "COMPANY_LEADER") {
  const capabilities = await participantCapabilities(tx, participant.id, role);
  if (!capabilities.editable) throw new DomainError("EDIT_LOCKED");
  const current=await tx.eventParticipant.findUniqueOrThrow({where:{id:participant.id},select:{registrationId:true}});
  await assertRegistrationNotErasing(tx,current.registrationId);
  return capabilities;
}

export async function createParticipant(db: PrismaClient, context: ActorContext, registrationId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const registration = await tx.companyEventRegistration.findUnique({ where: { id: registrationId }, include: { event: true } });
    if (!registration) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, registration.companyId);
    await assertRegistrationNotErasing(tx,registration.id);
    if (!(await registrationCapabilities(tx, registration.id, actor.role)).add) throw new DomainError("EDIT_LOCKED");
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
    await assertRegistrationNotErasing(tx,registration.id);
    if((await tx.company.findUniqueOrThrow({where:{id:registration.companyId}})).internalOrganisation) throw new DomainError("FORBIDDEN");
    if(!(await registrationCapabilities(tx,registration.id,actor.role)).employeeLinks) throw new DomainError("EDIT_LOCKED");
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
    if((await tx.company.findUniqueOrThrow({where:{id:participant.registration.companyId}})).internalOrganisation) throw new DomainError("FORBIDDEN");
    const capabilities=await assertParticipantLeaderCanEdit(tx, participant, actor.role);
    if(capabilities.fields.length!==6) throw new DomainError("EDIT_LOCKED");
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
  assertEmployeeCanEdit(invitation.participant);
  await assertRegistrationNotErasing(db,invitation.participant.registrationId);
  const jobRoles = await db.jobRole.findMany({ where: { deactivatedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  return { participantId: invitation.participantId, participantVersion: invitation.participant.version, registrationId: invitation.participant.registrationId, eventId: event.id, companyName: invitation.participant.registration.company.name, eventName: event.name, startDate: event.startDate, endDate: event.endDate, jobRoles, expiresAt: invitation.expiresAt };
}

export function assertEmployeeCanEdit(participant: { status: string; registration: { status: string; company: { deactivatedAt: Date | null; internalOrganisation?:string|null } } }) {
  if (participant.registration.company.deactivatedAt || participant.registration.company.internalOrganisation || participant.status !== "AWAITING_EMPLOYEE" || !["DRAFT", "RETURNED_FOR_CORRECTION"].includes(participant.registration.status)) throw new DomainError("TOKEN_UNAVAILABLE");
}

const employeeDetails = details.extend({ privacyAcknowledged: z.literal(true), privacyNoticeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),noticeLocale:z.enum(["pt","en"]).optional(), privacyNoticeVersion: z.string().min(1).max(100) }).strict();
export async function submitEmployeeOnboarding(db: PrismaClient, rawToken: string, raw: z.input<typeof employeeDetails>, keys: SensitiveKeys, photoObjectKey: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw new DomainError("TOKEN_UNAVAILABLE");
  const input = employeeDetails.parse(raw);
  return transaction(db, async tx => {
    const invitation = await tx.employeeInvitationToken.findUnique({ where: { tokenHash: tokenHash(rawToken) }, include: { participant: { include: { registration: { include: { event: true, company: true } } } } } });
    const registration = invitation?.participant.registration, event = registration?.event;
    if (!invitation || !registration || !event || invitation.usedAt || invitation.revokedAt || invitation.expiresAt <= now || event.onboardingOpensAt > now || event.onboardingClosesAt <= now || !isPublishedEvent(event.status)) throw new DomainError("TOKEN_UNAVAILABLE");
    assertEmployeeCanEdit(invitation.participant);
    await assertRegistrationNotErasing(tx,registration.id);
    await recordPrivacyAcknowledgement(tx,{eventId:event.id,registrationId:registration.id,participantId:invitation.participantId,actorType:"EMPLOYEE_LINK",kind:"WORKER",version:input.privacyNoticeVersion,locale:input.noticeLocale,presentedHash:input.privacyNoticeHash});
    await adoptPhotoUpload(tx, photoObjectKey, invitation.participant);
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
      documentExpiryDate: toDate(input.documentExpiryDate), mobileE164: normalizePhoneNumber(input.mobile), nationalityCode: input.nationalityCode,
      jobRoleId: input.jobRoleId, photoObjectKey, privacyNoticeVersion: input.privacyNoticeVersion, privacyAcknowledgedAt: now,
      status: duplicate ? "DUPLICATE_REVIEW_REQUIRED" : "AWAITING_LEADER_REVIEW", version: { increment: 1 },
    } });
    await replaceWorkDays(tx, invitation.participantId, input.workDays);
    await appendEmployeeAudit(tx, randomUUID(), { action: "PARTICIPANT_SUBMITTED", entityType: "EventParticipant", entityId: invitation.participantId, eventId: event.id, companyId: registration.companyId });
    return { participantId: invitation.participantId, duplicate };
  });
}

const draftDetails = z.object({
  fullName: z.string().trim().min(1).max(200).nullable(),
  dateOfBirth: calendarDate.nullable(),
  documentType: documentType.nullable(),
  documentNumber: z.string().trim().min(3).max(100).nullable(),
  documentExpiryDate: calendarDate.nullable(),
  mobile: z.string().trim().min(1).max(40).nullable(),
  nationalityCode: z.string().trim().length(2).transform(value => value.toUpperCase()).refine(value => /^[A-Z]{2}$/.test(value)).nullable(),
  jobRoleId: z.uuid().nullable(),
  workDays: z.array(calendarDate).max(366).refine(days => new Set(days).size === days.length),
  privacyAcknowledged: z.boolean(),
  privacyNoticeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  privacyNoticeVersion: z.string().min(1).max(100).nullable(),
  noticeLocale:z.enum(["pt","en"]).optional(),
}).strict().refine(value => !value.privacyAcknowledged || Boolean(value.privacyNoticeVersion));

export async function saveParticipantDraft(db: PrismaClient, context: ActorContext, participantId: string, raw: z.input<typeof draftDetails>, keys: SensitiveKeys, photoObjectKey?: string) {
  const input = draftDetails.parse(raw);
  const draftMobile = input.mobile && !/^\+\d{1,3}$/.test(input.mobile.replace(/[\s()-]/g, "")) ? input.mobile : null;
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant, actor.role);
    if (!(await participantCapabilities(tx,participant.id,actor.role)).canSaveDraft) throw new DomainError("EDIT_LOCKED");
    if(input.privacyAcknowledged) await recordPrivacyAcknowledgement(tx,{eventId:participant.eventId,registrationId:participant.registrationId,participantId,actorType:actor.role,actorUserId:actor.userId,kind:"WORKER",version:input.privacyNoticeVersion!,locale:input.noticeLocale});
    if (photoObjectKey) await adoptPhotoUpload(tx, photoObjectKey, participant);
    await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });

    const hasData = Boolean(
      input.fullName || input.dateOfBirth || input.documentType || input.documentNumber || input.documentExpiryDate || draftMobile ||
      input.nationalityCode || input.jobRoleId || input.workDays.length || input.privacyAcknowledged || photoObjectKey || participant.photoObjectKey,
    );
    if (!hasData) {
      await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "REMOVED", version: { increment: 1 } } });
      await appendAudit(tx, actor, { action: "PARTICIPANT_REMOVED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
      return { removed: true };
    }

    if (input.workDays.some(day => day < participant.registration.event.startDate.toISOString().slice(0, 10) || day > participant.registration.event.endDate.toISOString().slice(0, 10))) throw new DomainError("INVALID_INPUT");
    if (input.jobRoleId && !await tx.jobRole.findFirst({ where: { id: input.jobRoleId, deactivatedAt: null }, select: { id: true } })) throw new DomainError("INVALID_INPUT");
    if (input.documentNumber && !input.documentType) throw new DomainError("INVALID_INPUT");
    const protectedNumber = input.documentNumber && input.documentType
      ? protectDocumentNumber(input.documentType, input.documentNumber, participant.id, keys.encryptionKey, keys.fingerprintKey)
      : {
          documentNumberCiphertext: null, documentNumberIv: null, documentNumberAuthTag: null,
          documentNumberKeyVersion: null, documentNumberFingerprint: null, documentNumberLast3: null,
        };
    await tx.eventParticipant.update({ where: { id: participant.id }, data: {
      fullName: input.fullName, dateOfBirth: input.dateOfBirth ? toDate(input.dateOfBirth) : null,
      documentType: input.documentType, ...protectedNumber,
      documentExpiryDate: input.documentExpiryDate ? toDate(input.documentExpiryDate) : null,
      mobileE164: draftMobile ? normalizePhoneNumber(draftMobile) : null,
      nationalityCode: input.nationalityCode, jobRoleId: input.jobRoleId,
      ...(photoObjectKey ? { photoObjectKey } : {}),
      privacyAcknowledgedAt: input.privacyAcknowledged ? participant.privacyAcknowledgedAt ?? new Date() : null,
      privacyNoticeVersion: input.privacyAcknowledged ? input.privacyNoticeVersion : null,
      version: { increment: 1 },
    } });
    await replaceWorkDays(tx, participant.id, input.workDays);
    await appendAudit(tx, actor, { action: "PARTICIPANT_UPDATED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
    return { removed: false };
  });
}

const leaderDetails = details.extend({
  privacyAcknowledged: z.boolean().optional(),
  privacyNoticeVersion: z.string().min(1).max(100).optional(),
  privacyNoticeHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),noticeLocale: z.enum(["pt","en"]).optional(),
}).strict().refine(value => !value.privacyAcknowledged || Boolean(value.privacyNoticeVersion));

export async function updateParticipantByLeader(db: PrismaClient, context: ActorContext, participantId: string, raw: z.input<typeof leaderDetails>, keys: SensitiveKeys, photoObjectKey?: string, expectedVersion?:number) {
  const input = leaderDetails.parse(raw);
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    await assertParticipantLeaderCanEdit(tx, participant, actor.role);
    const capabilities = await participantCapabilities(tx, participant.id, actor.role);
    if(expectedVersion!==undefined && participant.version!==expectedVersion) throw new DomainError("STALE_WRITE");
    const oldDays = (await tx.participantWorkDay.findMany({where:{participantId}})).map(x=>x.workDate.toISOString().slice(0,10)).sort();
    const has = (field: typeof capabilities.fields[number]) => capabilities.fields.includes(field);
    if ((!has("PHOTO") && photoObjectKey && photoObjectKey !== participant.photoObjectKey) ||
        (!has("IDENTITY") && (input.fullName !== participant.fullName || input.dateOfBirth !== participant.dateOfBirth?.toISOString().slice(0,10) || input.documentType !== participant.documentType || input.documentExpiryDate !== participant.documentExpiryDate?.toISOString().slice(0,10) || input.nationalityCode !== participant.nationalityCode || (input.documentNumber && normalizeDocumentNumber(input.documentNumber) !== normalizeDocumentNumber(revealDocumentNumber(participant,keys.encryptionKey)??"")))) ||
        (!has("CONTACT") && normalizePhoneNumber(input.mobile) !== participant.mobileE164) ||
        (!has("ROLE") && input.jobRoleId !== participant.jobRoleId) ||
        (!has("WORK_DAYS") && JSON.stringify([...input.workDays].sort()) !== JSON.stringify(oldDays)) ||
        (!has("PRIVACY") && input.privacyAcknowledged && (!participant.privacyAcknowledgedAt || input.privacyNoticeVersion!==participant.privacyNoticeVersion))) throw new DomainError("EDIT_LOCKED");
    if(input.privacyAcknowledged && has("PRIVACY")) await recordPrivacyAcknowledgement(tx,{eventId:participant.eventId,registrationId:participant.registrationId,participantId,actorType:actor.role,actorUserId:actor.userId,kind:"WORKER",version:input.privacyNoticeVersion!,locale:input.noticeLocale});
    if (photoObjectKey) await adoptPhotoUpload(tx, photoObjectKey, participant);
    await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    validateSchedule(input, participant.registration.event);
    const role = await tx.jobRole.findFirst({ where: { id: input.jobRoleId, deactivatedAt: null } });
    if (!role) throw new DomainError("INVALID_INPUT");
    let protectedNumber: ReturnType<typeof protectDocumentNumber> | Record<string, never> = {};
    let fingerprint = participant.documentNumberFingerprint;
    if (input.documentNumber) {
      protectedNumber = protectDocumentNumber(input.documentType, input.documentNumber, participant.id, keys.encryptionKey, keys.fingerprintKey);
      fingerprint = protectedNumber.documentNumberFingerprint;
    }
    if (!fingerprint || (!input.documentNumber && input.documentType !== participant.documentType)) throw new DomainError("INVALID_INPUT");
    const duplicate = await duplicateExists(tx, participant.id, participant.eventId, fingerprint);
    const hasPhoto = Boolean(photoObjectKey ?? participant.photoObjectKey);
    const ready = hasPhoto && Boolean(participant.privacyAcknowledgedAt || input.privacyAcknowledged);
    await tx.eventParticipant.update({ where: { id: participant.id }, data: {
      fullName: input.fullName, dateOfBirth: toDate(input.dateOfBirth), documentType: input.documentType, ...protectedNumber,
      documentExpiryDate: toDate(input.documentExpiryDate), mobileE164: normalizePhoneNumber(input.mobile), nationalityCode: input.nationalityCode,
      jobRoleId: input.jobRoleId, ...(photoObjectKey ? { photoObjectKey } : {}),
      ...(input.privacyAcknowledged && has("PRIVACY") ? { privacyAcknowledgedAt: new Date(), privacyNoticeVersion: input.privacyNoticeVersion } : {}),
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
    await assertParticipantLeaderCanEdit(tx, participant, actor.role);
    const grant = participant.editRequestId ? await tx.companyRequest.findUnique({where:{id:participant.editRequestId}}) : null;
    if (grant?.status === "APPROVED" && !grant.fulfilledBySubmissionId && ((grant.type === "REPLACE_PHOTO" && participant.photoObjectKey === grant.effectBasePhotoKey) || (grant.type === "EDIT_PERSON" && participant.version <= (grant.effectBaseVersion ?? participant.version)))) throw new DomainError("SUBMISSION_INCOMPLETE");
    if (participant.status !== "AWAITING_LEADER_REVIEW" || !participant.photoObjectKey || !participant.privacyAcknowledgedAt || !participant.fullName || !participant.documentNumberFingerprint || !participant.documentExpiryDate || !participant.jobRoleId || !participant.mobileE164 || !participant.dateOfBirth || !participant.nationalityCode || !participant.workDays.length) throw new DomainError("INVALID_INPUT");
    if (!documentValidThroughEvent(participant.documentExpiryDate.toISOString().slice(0, 10), participant.registration.event.endDate.toISOString().slice(0, 10))) throw new DomainError("INVALID_INPUT");
    await validateParticipantEligibility(tx, participant, participant.registration.event);
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "LEADER_APPROVED", version: { increment: 1 } } });
    await tx.employeeInvitationToken.updateMany({ where: { participantId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await appendAudit(tx, actor, { action: "PARTICIPANT_APPROVED", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId });
  });
}

export async function removeParticipant(db: PrismaClient, context: ActorContext, participantId: string) {
  return transaction(db, async tx => {
    const actor = await resolveActor(tx, context);
    const participant = await tx.eventParticipant.findUnique({ where: { id: participantId }, include: { registration: { include: { event: true } } } });
    if (!participant || !activeStatuses.includes(participant.status as typeof activeStatuses[number])) throw new DomainError("FORBIDDEN");
    await requireCompany(tx, actor, participant.registration.companyId);
    if (!(await participantCapabilities(tx, participant.id, actor.role)).canRemove) throw new DomainError("EDIT_LOCKED");
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
    assertCompanyActive(await tx.company.findUnique({ where: { id: participant.registration.companyId } }));
    if (!["DRAFT", "RETURNED_FOR_CORRECTION"].includes(participant.registration.status)) throw new DomainError("EDIT_LOCKED");
    await tx.eventParticipant.update({ where: { id: participantId }, data: { status: "AWAITING_LEADER_REVIEW", version: { increment: 1 } } });
    await appendAudit(tx, actor, { action: "DUPLICATE_OVERRIDDEN", entityType: "EventParticipant", entityId: participant.id, eventId: participant.eventId, companyId: participant.registration.companyId, metadata: { override: true, reasonCategory: "DUPLICATE" } });
  });
}
