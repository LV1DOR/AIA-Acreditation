"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { abandonPhotoUpload, prepareLeaderPhotoUpload, updateParticipantByLeader,
  ensureLeaderSelfParticipant, linkLeaderSelfParticipant, leaderSelfProfiles, leaderParticipant, DomainError } from "@aia/domain";
import { requirePortal } from "../../../server/session.ts";
import { database } from "../../../server/runtime.ts";
import { storageEnvironment } from "../../../server/storage.ts";
import { storeParticipantPhoto } from "../../../server/participant-photo.ts";

export async function saveMyDetails(data: FormData) {
  const locale = data.get("locale") === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  let stagedKey: string | undefined;
  let completed = false;
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER", { allowIncompleteLeaderProfile: true });
    const db = database();
    const profile = (await leaderSelfProfiles(db, access.context)).find(row => row.registrationId === registrationId);
    if (!profile) throw new DomainError("FORBIDDEN");
    const intent = String(data.get("intent"));
    if (intent === "start") await ensureLeaderSelfParticipant(db, access.context, registrationId);
    else if (intent === "link") {
      if (data.get("thisIsMe") !== "on") throw new DomainError("INVALID_INPUT");
      await linkLeaderSelfParticipant(db, access.context, { registrationId, participantId: String(data.get("existingParticipantId") ?? "") });
    } else if (intent === "save") {
      if (!profile.participantId) throw new DomainError("FORBIDDEN");
      const environment = storageEnvironment();
      // The worker ID is obtained from the authenticated user's server mapping,
      // never from a hidden participantId or other client identity field.
      const current = await leaderParticipant(db, access.context, profile.participantId, environment.DOCUMENT_ENCRYPTION_KEY);
      if (current.participant.registrationId !== registrationId) throw new DomainError("FORBIDDEN");
      const p = current.participant;
      const fallback: Record<string, string> = { fullName: p.fullName ?? "", dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) ?? "",
        documentType: p.documentType ?? "", documentNumber: p.documentNumber ?? "", documentExpiryDate: p.documentExpiryDate?.toISOString().slice(0, 10) ?? "",
        mobile: p.mobileE164 ?? "", nationalityCode: p.nationalityCode ?? "", jobRoleId: p.jobRoleId ?? "" };
      for (const [key, value] of Object.entries(fallback)) if (!data.has(key)) data.set(key, value);
      if (!current.capabilities.fields.includes("WORK_DAYS") && !data.has("workDays")) for (const day of p.workDays) data.append("workDays", day.workDate.toISOString().slice(0, 10));
      let photoObjectKey: string | undefined;
      const file = data.get("photo");
      if (file instanceof File && file.size) {
        const upload = await prepareLeaderPhotoUpload(db, access.context, p.id, environment.MINIO_PHOTOS_BUCKET);
        stagedKey = upload.objectKey;
        photoObjectKey = await storeParticipantPhoto(file, upload.objectKey);
      }
      await updateParticipantByLeader(db, access.context, p.id, {
        fullName: String(data.get("fullName") ?? ""), dateOfBirth: String(data.get("dateOfBirth") ?? ""),
        documentType: String(data.get("documentType") ?? "") as "PASSPORT",
        documentNumber: String(data.get("documentNumber") ?? "").trim() || undefined,
        documentExpiryDate: String(data.get("documentExpiryDate") ?? ""), mobile: String(data.get("mobile") ?? ""),
        nationalityCode: String(data.get("nationalityCode") ?? ""), jobRoleId: String(data.get("jobRoleId") ?? ""),
        workDays: data.getAll("workDays").map(String), privacyAcknowledged: data.get("privacyAcknowledged") === "on" || undefined,
        privacyNoticeVersion: String(data.get("privacyNoticeVersion") ?? "") || undefined,
        privacyNoticeHash: String(data.get("privacyNoticeHash") ?? "") || undefined, noticeLocale: locale,
      }, { encryptionKey: environment.DOCUMENT_ENCRYPTION_KEY, fingerprintKey: environment.DOCUMENT_FINGERPRINT_KEY },
      photoObjectKey, Number(data.get("expectedVersion")));
      completed = true;
    } else throw new DomainError("INVALID_INPUT");
  } catch (error) {
    if (stagedKey) await abandonPhotoUpload(database(), stagedKey).catch(() => {});
    if (error && typeof error === "object" && "digest" in error) throw error;
    const code = error instanceof DomainError ? error.code.toLowerCase()
      : error instanceof Error && error.message === "IMAGE_PROCESSING_BUSY" ? "busy" : "error";
    redirect(`/${locale}/my-details?registrationId=${encodeURIComponent(registrationId)}&result=${code}`);
  }
  revalidatePath(`/${locale}/company`);
  revalidatePath(`/${locale}/company/${registrationId}`);
  revalidatePath(`/${locale}/my-details`);
  redirect(completed ? `/${locale}/portal` : `/${locale}/my-details?registrationId=${encodeURIComponent(registrationId)}`);
}
