"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { abandonPhotoUpload, prepareLeaderPhotoUpload, updateParticipantByLeader, approveParticipant, updateInternalWorkerZones, submitCompanyRegistration, reopenInternalRegistration, updatePersonnelLimit, overrideDuplicate, reinstateRemovedParticipant, internalWorkers, DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
import { storageEnvironment } from "@/server/storage.ts";
import { storeParticipantPhoto } from "@/server/participant-photo.ts";
export async function internalWorkerAction(data:FormData) {
  const locale:Locale=data.get("locale")==="en"?"en":"pt",registrationId=String(data.get("registrationId")),participantId=String(data.get("participantId")??""),intent=String(data.get("intent"));
  const path=`/${locale}/admin/people/internal/${registrationId}${["save","zones","ready","duplicate"].includes(intent)?`/${participantId}`:""}`;
  let stagedKey:string|undefined;
  let eventId:string|undefined;
  try {
    const access=await requirePortal(locale,"ADMIN"),env=storageEnvironment(),keys={encryptionKey:env.DOCUMENT_ENCRYPTION_KEY,fingerprintKey:env.DOCUMENT_FINGERPRINT_KEY};
    // Validate the internal target even for reused external-domain operations.
    const current=await internalWorkers(database(),access.context,registrationId,keys);
    eventId=current.registration.eventId;
    const p=current.workers.find(x=>x.id===participantId);
    if(["save","zones","ready","duplicate","reinstate"].includes(intent) && !p) throw new DomainError("FORBIDDEN");
    if(intent==="save") {
      const file=data.get("photo");let photoKey:string|undefined;
      if(file instanceof File && file.size) {const upload=await prepareLeaderPhotoUpload(database(),access.context,participantId,env.MINIO_PHOTOS_BUCKET);stagedKey=upload.objectKey;photoKey=await storeParticipantPhoto(file,upload.objectKey);}
      await updateParticipantByLeader(database(),access.context,participantId,{fullName:String(data.get("fullName")),dateOfBirth:String(data.get("dateOfBirth")),documentType:String(data.get("documentType")) as "PASSPORT",documentNumber:String(data.get("documentNumber")??"")||undefined,documentExpiryDate:String(data.get("documentExpiryDate")),mobile:String(data.get("mobile")),nationalityCode:String(data.get("nationalityCode")),jobRoleId:String(data.get("jobRoleId")),workDays:data.getAll("workDays").map(String),privacyAcknowledged:data.get("privacyAcknowledged")==="on"||undefined,noticeLocale:locale, privacyNoticeHash:String(data.get("privacyNoticeHash")??"")||undefined,privacyNoticeVersion:String(data.get("privacyNoticeVersion")??"")||undefined},keys,photoKey,Number(data.get("version")));
    } else if(intent==="zones") await updateInternalWorkerZones(database(),access.context,{participantId,expectedVersion:Number(data.get("version")),zoneIds:data.getAll("zoneIds").map(String),reason:String(data.get("reason"))});
    else if(intent==="ready") await approveParticipant(database(),access.context,participantId);
    else if(intent==="duplicate") await overrideDuplicate(database(),access.context,participantId);
    else if(intent==="reinstate") await reinstateRemovedParticipant(database(),access.context,{participantId,expectedVersion:Number(data.get("version")),reason:String(data.get("reason"))});
    else if(intent==="capacity") await updatePersonnelLimit(database(),access.context,{registrationId,expectedVersion:Number(data.get("version")),personnelLimit:Number(data.get("personnelLimit"))});
    else if(intent==="reopen") await reopenInternalRegistration(database(),access.context,registrationId,Number(data.get("version")),String(data.get("reason")));
    else if(intent==="submit") {const s=await submitCompanyRegistration(database(),access.context,{registrationId,expectedVersion:Number(data.get("version")),dataProcessingAccepted:(data.get("consent")==="on") as true,noticeLocale:locale,dataProcessingNoticeHash:String(data.get("dataProcessingNoticeHash")??"")||undefined,dataProcessingNoticeVersion:String(data.get("dataProcessingNoticeVersion"))},env.DOCUMENT_ENCRYPTION_KEY);revalidatePath(`/${locale}/admin/people`);redirect(`/${locale}/admin/queue/${s.id}?eventId=${current.registration.eventId}`);}
    else throw new DomainError("INVALID_INPUT");
  } catch(error) {
    if(stagedKey) await abandonPhotoUpload(database(),stagedKey).catch(()=>{});
    if(error && typeof error==="object" && "digest" in error) throw error;
    redirect(`${path}?eventId=${eventId??""}&result=${error instanceof DomainError?error.code.toLowerCase():"invalid_input"}`);
  }
  revalidatePath(`/${locale}/admin/people`);revalidatePath(`/${locale}/admin/people/internal/${registrationId}`);
  redirect(`${path}?result=saved`);
}
