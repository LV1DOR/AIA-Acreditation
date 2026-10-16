"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { abandonPhotoUpload, prepareSubmissionPhotoUpload, DomainError, recordSubmissionPhotoAdjustment, reviewCompanySubmission, reviewSubmissionParticipant } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../../server/session.ts";
import { database } from "../../../../../server/runtime.ts";
import { storeParticipantPhoto } from "../../../../../server/participant-photo.ts";
import { storageEnvironment } from "../../../../../server/storage.ts";

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
    redirect(`/${locale}/admin/submissions/${submissionId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/admin/submissions`);
  redirect(`/${locale}/admin/submissions/${submissionId}?result=saved`);
}

export async function reviewSubmissionParticipantAction(data:FormData) {
  const locale:Locale=String(data.get("locale")) === "en" ? "en":"pt";
  const submissionId=String(data.get("submissionId")??"");
  const participantId=String(data.get("participantId")??"");
  const outcome=String(data.get("outcome"));
  try {
    const access=await requirePortal(locale,"ADMIN");
    if(outcome === "APPROVED") await reviewSubmissionParticipant(database(),access.context,{submissionId,participantId,outcome});
    else if(outcome === "RETURNED_FOR_CORRECTION") await reviewSubmissionParticipant(database(),access.context,{submissionId,participantId,outcome,reason:String(data.get("reason")) as "PHOTO",comment:String(data.get("comment")??"")});
    else throw new DomainError("INVALID_INPUT");
  } catch(error) {
    if(error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/submissions/${submissionId}?result=${error instanceof DomainError ? error.code.toLowerCase():"error"}`);
  }
  revalidatePath(`/${locale}/admin/submissions/${submissionId}`);
  redirect(`/${locale}/admin/submissions/${submissionId}?result=person_saved`);
}

export async function adjustSubmissionPhotoAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const submissionId = String(data.get("submissionId") ?? "");
  const participantId = String(data.get("participantId") ?? "");
  let stagedKey: string | undefined;
  try {
    const access = await requirePortal(locale, "ADMIN");
    const photo = data.get("photo");
    if (!(photo instanceof File) || !photo.size) throw new DomainError("INVALID_INPUT");
    const upload = await prepareSubmissionPhotoUpload(database(), access.context, submissionId, participantId, storageEnvironment().MINIO_PHOTOS_BUCKET);
    const key = upload.objectKey;
    stagedKey = key;
    await storeParticipantPhoto(photo, key);
    await recordSubmissionPhotoAdjustment(database(), access.context, { submissionId, participantId, photoObjectKey: key });
  } catch (error) {
    if (stagedKey) await abandonPhotoUpload(database(), stagedKey).catch(() => { /* original durable expiry remains */ });
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/submissions/${submissionId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/admin/submissions/${submissionId}`);
  redirect(`/${locale}/admin/submissions/${submissionId}?result=photo_saved`);
}
