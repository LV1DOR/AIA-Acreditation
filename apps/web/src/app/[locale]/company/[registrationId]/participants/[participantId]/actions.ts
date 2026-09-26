"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { approveParticipant, DomainError, leaderParticipant, updateParticipantByLeader } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../../../server/session.ts";
import { database } from "../../../../../../server/runtime.ts";
import { participantPhotoKey, storeParticipantPhoto } from "../../../../../../server/participant-photo.ts";
import { storageEnvironment } from "../../../../../../server/storage.ts";

function target(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  return { locale, registrationId: String(data.get("registrationId") ?? ""), participantId: String(data.get("participantId") ?? "") };
}

export async function saveParticipantAction(data: FormData) {
  const value = target(data);
  try {
    const access = await requirePortal(value.locale, "COMPANY_LEADER");
    const environment = storageEnvironment();
    const current = await leaderParticipant(database(), access.context, value.participantId, environment.DOCUMENT_ENCRYPTION_KEY);
    const file = data.get("photo");
    let photoObjectKey: string | undefined;
    if (file instanceof File && file.size) {
      const key = participantPhotoKey(current.participant.eventId, current.participant.registrationId, current.participant.id);
      photoObjectKey = await storeParticipantPhoto(file, key);
    }
    await updateParticipantByLeader(database(), access.context, value.participantId, {
      fullName: String(data.get("fullName") ?? ""), dateOfBirth: String(data.get("dateOfBirth") ?? ""),
      documentType: String(data.get("documentType") ?? "") as "PASSPORT",
      documentNumber: String(data.get("documentNumber") ?? "").trim() || undefined,
      documentExpiryDate: String(data.get("documentExpiryDate") ?? ""), mobile: String(data.get("mobile") ?? ""),
      nationalityCode: String(data.get("nationalityCode") ?? ""), jobRoleId: String(data.get("jobRoleId") ?? ""),
      workDays: data.getAll("workDays").map(String),
      privacyAcknowledged: data.get("privacyAcknowledged") === "on" || undefined,
      privacyNoticeVersion: String(data.get("privacyNoticeVersion") ?? "") || undefined,
    }, { encryptionKey: environment.DOCUMENT_ENCRYPTION_KEY, fingerprintKey: environment.DOCUMENT_FINGERPRINT_KEY }, photoObjectKey);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const result = error instanceof DomainError ? error.code.toLowerCase() : "error";
    redirect(`/${value.locale}/company/${value.registrationId}/participants/${value.participantId}?result=${result}`);
  }
  revalidatePath(`/${value.locale}/company/${value.registrationId}`);
  revalidatePath(`/${value.locale}/company/${value.registrationId}/participants/${value.participantId}`);
  redirect(`/${value.locale}/company/${value.registrationId}/participants/${value.participantId}?result=saved`);
}

export async function approveParticipantAction(data: FormData) {
  const value = target(data);
  try {
    const access = await requirePortal(value.locale, "COMPANY_LEADER");
    await approveParticipant(database(), access.context, value.participantId);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const result = error instanceof DomainError ? error.code.toLowerCase() : "error";
    redirect(`/${value.locale}/company/${value.registrationId}/participants/${value.participantId}?result=${result}`);
  }
  revalidatePath(`/${value.locale}/company/${value.registrationId}`);
  redirect(`/${value.locale}/company/${value.registrationId}?result=saved`);
}
