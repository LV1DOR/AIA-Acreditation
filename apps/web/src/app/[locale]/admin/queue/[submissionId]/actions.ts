"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminSubmissionPhotoTarget, DomainError, recordSubmissionPhotoAdjustment, reviewCompanySubmission } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../../server/session.ts";
import { database } from "../../../../../server/runtime.ts";
import { storeParticipantPhoto, submissionPhotoAdjustmentKey } from "../../../../../server/participant-photo.ts";

export async function reviewSubmissionAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const submissionId = String(data.get("submissionId") ?? "");
  const action = String(data.get("decision"));
  try {
    const access = await requirePortal(locale, "ADMIN");
    const base = { submissionId, expectedRegistrationVersion: Number(data.get("expectedRegistrationVersion")) };
    if (action === "APPROVE") await reviewCompanySubmission(database(), access.context, { ...base, action });
    else if (action === "RETURN" || action === "REJECT") await reviewCompanySubmission(database(), access.context, { ...base, action, reason: String(data.get("reason")) as "OTHER", comment: String(data.get("comment") ?? "") });
    else throw new DomainError("INVALID_INPUT");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/queue/${submissionId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/admin/queue`);
  redirect(`/${locale}/admin/queue/${submissionId}?result=saved`);
}

export async function adjustSubmissionPhotoAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const submissionId = String(data.get("submissionId") ?? "");
  const participantId = String(data.get("participantId") ?? "");
  try {
    const access = await requirePortal(locale, "ADMIN");
    const target = await adminSubmissionPhotoTarget(database(), access.context, submissionId, participantId);
    const photo = data.get("photo");
    if (!(photo instanceof File) || !photo.size) throw new DomainError("INVALID_INPUT");
    const key = submissionPhotoAdjustmentKey(target.eventId, target.registrationId, target.participantId, submissionId);
    await storeParticipantPhoto(photo, key);
    await recordSubmissionPhotoAdjustment(database(), access.context, { submissionId, participantId, photoObjectKey: key });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/queue/${submissionId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/admin/queue/${submissionId}`);
  redirect(`/${locale}/admin/queue/${submissionId}?result=photo_saved`);
}
