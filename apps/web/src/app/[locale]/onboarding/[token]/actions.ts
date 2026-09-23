"use server";

import { redirect } from "next/navigation";
import { employeeInvitationView, submitEmployeeOnboarding } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { database } from "../../../../server/runtime.ts";
import { enforcePublicRateLimit } from "../../../../server/rate-limit.ts";
import { participantPhotoKey, storeParticipantPhoto } from "../../../../server/participant-photo.ts";
import { storageEnvironment } from "../../../../server/storage.ts";

export async function submitOnboardingAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const token = String(data.get("token") ?? "");
  try {
    await enforcePublicRateLimit("employee-submit", token, 10, 900);
    const invitation = await employeeInvitationView(database(), token);
    const photo = data.get("photo");
    if (!(photo instanceof File) || !photo.size) throw new Error("PHOTO_REQUIRED");
    const photoObjectKey = await storeParticipantPhoto(photo, participantPhotoKey(invitation.eventId, invitation.registrationId, invitation.participantId));
    const environment = storageEnvironment();
    if (data.get("privacyAcknowledged") !== "on") throw new Error("PRIVACY_ACKNOWLEDGEMENT_REQUIRED");
    await submitEmployeeOnboarding(database(), token, {
      fullName: String(data.get("fullName") ?? ""), dateOfBirth: String(data.get("dateOfBirth") ?? ""),
      documentType: String(data.get("documentType") ?? "") as "PASSPORT", documentNumber: String(data.get("documentNumber") ?? ""),
      documentExpiryDate: String(data.get("documentExpiryDate") ?? ""), mobile: String(data.get("mobile") ?? ""),
      nationalityCode: String(data.get("nationalityCode") ?? ""), jobRoleId: String(data.get("jobRoleId") ?? ""),
      workDays: data.getAll("workDays").map(String), privacyAcknowledged: true,
      privacyNoticeVersion: String(data.get("privacyNoticeVersion") ?? ""),
    }, { encryptionKey: environment.DOCUMENT_ENCRYPTION_KEY, fingerprintKey: environment.DOCUMENT_FINGERPRINT_KEY }, photoObjectKey);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/onboarding/${token}?result=error`);
  }
  redirect(`/${locale}/onboarding/complete`);
}
