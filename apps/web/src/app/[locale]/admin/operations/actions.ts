"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {publishPrivacyNotice,approveEventRetentionPolicy,setEventPrivacyHold,requestPrivacyErasure,attestExternalErasureCopies,recoverDelivery,purgeEventCommunications,purgeApprovedAuthenticationMetadata,reauthorisePendingPrivacyErasure,requestPrivacyEvidenceExpiry,DomainError} from "@aia/domain";
import {requirePortal} from "@/server/session.ts";
import {database} from "@/server/runtime.ts";
import {storageEnvironment} from "@/server/storage.ts";
export async function operationalAction(data:FormData) {
  const locale=data.get("locale")==="en"?"en":"pt",eventId=String(data.get("eventId")),text=(key:string)=>String(data.get(key)??"").trim();let result="saved";
  try {
    const access=await requirePortal(locale,"ADMIN"),context=access.context,db=database(),intent=text("intent");
    if(intent==="notice")await publishPrivacyNotice(db,context,{eventId,kind:text("kind") as "WORKER"|"LEADER",version:text("noticeVersion"),textPt:text("textPt"),textEn:text("textEn"),approvalReference:text("reference"),approved:(data.get("approved")==="on") as true});
    else if(intent==="policy")await approveEventRetentionPolicy(db,context,{eventId,recordsEraseAfter:new Date(text("recordsEraseAfter")+"T00:00:00Z"),evidenceEraseAfter:new Date(text("evidenceEraseAfter")+"T00:00:00Z"),communicationsEraseAfter:new Date(text("communicationsEraseAfter")+"T00:00:00Z"),backupsEraseAfter:new Date(text("backupsEraseAfter")+"T00:00:00Z"),approvalReference:text("reference"),approved:(data.get("approved")==="on") as true,automaticPurge:false});
    else if(intent==="hold")await setEventPrivacyHold(db,context,eventId,text("active")==="true",text("reference"));
    else if(intent==="erase"){const e=storageEnvironment();await requestPrivacyErasure(db,context,{registrationId:text("registrationId"),expectedVersion:Number(text("version")),previewHash:text("previewHash"),stage:text("stage") as "PERSONAL_DATA"|"ALL_EVIDENCE",authorisationReference:text("reference"),confirmed:(data.get("confirmed")==="on") as true},e.DOCUMENT_ENCRYPTION_KEY,e.MINIO_PHOTOS_BUCKET);result="queued";}
    else if(intent==="copies")await attestExternalErasureCopies(db,context,text("jobId"),text("reference"));
    else if(intent==="recover"){await recoverDelivery(db,context,text("messageId"),text("reference"));result="reissued";}
    else if(intent==="reauthorise")await reauthorisePendingPrivacyErasure(db,context,text("jobId"),text("reference"));
    else if(intent==="evidence")await requestPrivacyEvidenceExpiry(db,context,text("jobId"),text("reference"));
    else if(intent==="authmetadata")await purgeApprovedAuthenticationMetadata(db,context,text("reference"));
    else if(intent==="communications")await purgeEventCommunications(db,context,eventId,text("reference"));
    else throw new DomainError("INVALID_INPUT");
  }catch(error){if(error && typeof error==="object" && "digest" in error)throw error;result=error instanceof DomainError?error.code.toLowerCase():"invalid_input";}
  revalidatePath(`/${locale}/admin/operations`);redirect(`/${locale}/admin/operations?eventId=${encodeURIComponent(eventId)}&result=${result}`);
}
