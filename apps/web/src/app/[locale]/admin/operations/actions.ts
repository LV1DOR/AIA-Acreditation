"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {publishPrivacyNotice,approveEventRetentionPolicy,recoverDelivery,DomainError} from "@aia/domain";
import {requirePortal} from "@/server/session.ts";
import {database} from "@/server/runtime.ts";

export async function operationalAction(data:FormData) {
  const locale=data.get("locale")==="en"?"en":"pt";
  const text=(key:string)=>String(data.get(key)??"").trim(),eventId=text("eventId");
  let result="saved";
  try {
    const access=await requirePortal(locale,"ADMIN"),db=database(),intent=text("intent");
    if(intent==="notice")await publishPrivacyNotice(db,access.context,{
      eventId,kind:"WORKER",version:text("noticeVersion"),textPt:text("textPt"),textEn:text("textEn"),
      approved:(data.get("approved")==="on") as true,
    });
    else if(intent==="policy")await approveEventRetentionPolicy(db,access.context,{
      eventId,recordsEraseAfter:new Date(text("recordsEraseAfter")+"T00:00:00Z"),
      backupsEraseAfter:new Date(text("backupsEraseAfter")+"T00:00:00Z"),
      approved:(data.get("approved")==="on") as true,automaticPurge:false,
    });
    else if(intent==="recover"){
      await recoverDelivery(db,access.context,text("messageId"),"Admin requested a fresh portal update");result="reissued";
    }else throw new DomainError("INVALID_INPUT");
  }catch(error){
    if(error&&typeof error==="object"&&"digest" in error)throw error;
    result=error instanceof DomainError?error.code.toLowerCase():"invalid_input";
  }
  revalidatePath(`/${locale}/admin/operations`);
  redirect(`/${locale}/admin/operations?eventId=${encodeURIComponent(eventId)}&result=${result}`);
}
