"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { commitInternalImport, previewInternalImport, ensureInternalRegistration, DomainError } from "@aia/domain";
import { requirePortal } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
import { storageEnvironment } from "@/server/storage.ts";
import type { Locale } from "@aia/i18n";

export async function selectInternalOrganisation(data:FormData) {
  const locale:Locale=data.get("locale")==="en"?"en":"pt";
  const access=await requirePortal(locale,"ADMIN");
  let id:string,eventId:string;
  try { const r=await ensureInternalRegistration(database(),access.context,{eventId:String(data.get("eventId")),organisation:String(data.get("organisation")) as "AIA",personnelLimit:Number(data.get("personnelLimit"))});id=r.id;eventId=r.eventId; }
  catch(error){if(error && typeof error==="object" && "digest" in error) throw error;redirect(`/${locale}/admin/people/import?result=error`);}
  redirect(`/${locale}/admin/people/import?registrationId=${id}&eventId=${eventId}`);
}
export async function processInternalFile(data:FormData) {
  const locale:Locale=data.get("locale")==="en"?"en":"pt";
  const access=await requirePortal(locale,"ADMIN");
  const file=data.get("file"),registrationId=String(data.get("registrationId"));
  try {
    if(!(file instanceof File) || !file.size || file.size>4*1024*1024) throw new DomainError("INVALID_SPREADSHEET");
    const bytes=new Uint8Array(await file.arrayBuffer()),e=storageEnvironment(),keys={encryptionKey:e.DOCUMENT_ENCRYPTION_KEY,fingerprintKey:e.DOCUMENT_FINGERPRINT_KEY};
    if(data.get("intent")==="commit") {
      const result=await commitInternalImport(database(),access.context,{registrationId,fileHash:String(data.get("fileHash")),expectedVersion:Number(data.get("expectedVersion")),confirmed:(data.get("confirmed")==="on") as true},bytes,file.name,keys);
      revalidatePath(`/${locale}/admin/people`);
      return {ok:true as const,result:{created:result.createdCount,skipped:result.skippedCount,replayed:result.replayed},preview:null};
    }
    return {ok:true as const,preview:await previewInternalImport(database(),access.context,registrationId,bytes,file.name,keys),result:null};
  } catch(error) {
    if(error && typeof error==="object" && "digest" in error) throw error;
    return {ok:false as const,error:error instanceof DomainError?error.code:"INVALID_SPREADSHEET",preview:null,result:null};
  }
}
