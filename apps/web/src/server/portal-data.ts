import "server-only";
import { adminOverview, leaderOverview, auditOverview, notificationOverview, adminSetup, leaderRegistration, leaderParticipant, adminDuplicateReview, adminSubmission, decryptSubmissionSnapshot, revealDocumentNumber, companyRequests, pendingAdminRequests } from "@aia/domain";
import { parseStorageEnv } from "@aia/config";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "./session.ts";
import { database } from "./runtime.ts";
export async function loadAdmin(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return adminOverview(database(), access.context);
}
export async function loadLeader(locale: Locale) {
  const access = await requirePortal(locale, "COMPANY_LEADER");
  return leaderOverview(database(), access.context, parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY);
}
export async function loadAudit(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return auditOverview(database(), access.context);
}
export async function loadNotifications(locale: Locale) {
  const access = await requirePortal(locale);
  return notificationOverview(database(), access.context);
}
export async function loadAdminSetup(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return adminSetup(database(), access.context);
}
export async function loadLeaderRegistration(locale: Locale, registrationId: string) {
  const access = await requirePortal(locale, "COMPANY_LEADER");
  return leaderRegistration(database(), access.context, registrationId, parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY);
}
export async function loadLeaderParticipant(locale: Locale, participantId: string) {
  const access = await requirePortal(locale, "COMPANY_LEADER");
  return leaderParticipant(database(), access.context, participantId, parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY);
}
export async function loadDuplicateReview(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return adminDuplicateReview(database(), access.context);
}
export async function loadAdminSubmission(locale: Locale, submissionId: string) {
  const access = await requirePortal(locale, "ADMIN");
  const submission = await adminSubmission(database(), access.context, submissionId);
  const encryptionKey = parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY;
  const snapshot = decryptSubmissionSnapshot(submission.snapshot, encryptionKey, submission.id) as { participants?: Array<{ id:string; documentNumberCiphertext:string|null; documentNumberIv:string|null; documentNumberAuthTag:string|null; documentNumberKeyVersion:number|null }>; [key:string]:unknown };
  return { ...submission, snapshot: { ...snapshot, participants:snapshot.participants?.map(participant => ({ ...participant, documentNumber:revealDocumentNumber(participant,encryptionKey) })) ?? [] } };
}
export async function loadCompanyRequests(locale: Locale, registrationId: string) { const access=await requirePortal(locale,"COMPANY_LEADER"); return companyRequests(database(),access.context,registrationId); }
export async function loadPendingRequests(locale: Locale) { const access=await requirePortal(locale,"ADMIN"); return pendingAdminRequests(database(),access.context); }
