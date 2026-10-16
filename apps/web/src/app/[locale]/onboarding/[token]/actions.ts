"use server";

import { redirect } from "next/navigation";
import { abandonPhotoUpload, prepareEmployeePhotoUpload, employeeInvitationView, submitEmployeeOnboarding } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { database } from "../../../../server/runtime.ts";
import { enforcePublicRateLimit, enforcePublicRequestLimit } from "../../../../server/rate-limit.ts";
import { storeParticipantPhoto } from "../../../../server/participant-photo.ts";
import { storageEnvironment } from "../../../../server/storage.ts";

export async function submitOnboardingAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const token = String(data.get("token") ?? "");
  let stagedKey: string | undefined;
  try {
    await enforcePublicRequestLimit("employee-submit");
    await employeeInvitationView(database(), token);
    await enforcePublicRateLimit("employee-submit", token, 10, 900);
    const photo = data.get("photo");
    if (!(photo instanceof File) || !photo.size) throw new Error("PHOTO_REQUIRED");
    const environment = storageEnvironment();
    if (data.get("privacyAcknowledged") !== "on") throw new Error("PRIVACY_ACKNOWLEDGEMENT_REQUIRED");
    const upload = await prepareEmployeePhotoUpload(database(), token, environment.MINIO_PHOTOS_BUCKET);
    stagedKey = upload.objectKey;
    const photoObjectKey = await storeParticipantPhoto(photo, upload.objectKey);
    await submitEmployeeOnboarding(database(), token, {
      fullName: String(data.get("fullName") ?? ""), dateOfBirth: String(data.get("dateOfBirth") ?? ""),
      documentType: String(data.get("documentType") ?? "") as "PASSPORT", documentNumber: String(data.get("documentNumber") ?? ""),
      documentExpiryDate: String(data.get("documentExpiryDate") ?? ""), mobile: String(data.get("mobile") ?? ""),
      nationalityCode: String(data.get("nationalityCode") ?? ""), jobRoleId: String(data.get("jobRoleId") ?? ""),
      workDays: data.getAll("workDays").map(String), privacyAcknowledged: true,
      noticeLocale:locale, privacyNoticeHash:String(data.get("privacyNoticeHash")??"")||undefined,privacyNoticeVersion: String(data.get("privacyNoticeVersion") ?? ""),
    }, { encryptionKey: environment.DOCUMENT_ENCRYPTION_KEY, fingerprintKey: environment.DOCUMENT_FINGERPRINT_KEY }, photoObjectKey);
  } catch (error) {
    if (stagedKey) await abandonPhotoUpload(database(), stagedKey).catch(() => { /* original durable expiry remains */ });
    if (error && typeof error === "object" && "digest" in error) throw error;
    const result = error instanceof Error && ["RATE_LIMITED", "IMAGE_PROCESSING_BUSY"].includes(error.message) ? "busy" : "error";
    redirect(`/${locale}/onboarding/${token}?result=${result}`);
  }
  redirect(`/${locale}/onboarding/complete`);
}
