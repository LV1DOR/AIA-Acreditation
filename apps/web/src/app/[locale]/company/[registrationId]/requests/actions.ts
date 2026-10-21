"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cancelCompanyRequest, createCompanyRequest, DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../../server/session.ts";
import { database } from "../../../../../server/runtime.ts";

export async function createRequestAction(data: FormData) {
  const locale:Locale=String(data.get("locale")) === "en" ? "en" : "pt", registrationId=String(data.get("registrationId")??""), type=String(data.get("type"));
  try {
    const access=await requirePortal(locale,"COMPANY_LEADER");
    const payload = type === "EXTRA_PERSONNEL" ? { type:"EXTRA_PERSONNEL" as const, additionalSlots:Number(data.get("quantity")) }
      : type === "ADD_AFTER_DEADLINE" ? { type:"ADD_AFTER_DEADLINE" as const, count:Number(data.get("quantity")) }
      : type === "REMOVE_AFTER_DEADLINE" ? { type:"REMOVE_AFTER_DEADLINE" as const }
      : type === "VEHICLE_PASS_CHANGE" ? { type:"VEHICLE_PASS_CHANGE" as const, required:data.get("vehicleRequired") === "on", requestedQuantity:Number(data.get("vehicleQuantity")||0), justification:String(data.get("reason")??"").trim() || null }
      : type === "ZONE_CHANGE" ? { type:"ZONE_CHANGE" as const, zoneIds:data.getAll("zoneIds").map(String) }
      : type === "REPLACE_PERSON" ? { type:"REPLACE_PERSON" as const, replacementName:String(data.get("replacementName")??"") }
      : type === "EDIT_PERSON" ? {type:"EDIT_PERSON" as const,scope:String(data.get("scope")) as "IDENTITY"|"CONTACT"|"ROLE"|"OTHER"}
      : type === "REPLACE_PHOTO" ? {type:"REPLACE_PHOTO" as const}
      : type === "CHANGE_WORK_DAYS" ? {type:"CHANGE_WORK_DAYS" as const,workDays:String(data.get("workDays")??"").split(";").map(x=>x.trim())}
      : type === "OTHER" ? { type:"OTHER" as const } : (()=>{throw new DomainError("INVALID_INPUT");})();
    await createCompanyRequest(database(),access.context,{ registrationId, targetParticipantId:["REMOVE_AFTER_DEADLINE","REPLACE_PERSON","EDIT_PERSON","REPLACE_PHOTO","CHANGE_WORK_DAYS"].includes(type) ? String(data.get("targetParticipantId")??"") : undefined, priority:data.get("urgent") === "on" ? "URGENT" : "NORMAL", reason:String(data.get("reason")??""), payload });
  } catch(error) { if(error && typeof error === "object" && "digest" in error) throw error; redirect(`/${locale}/company/${registrationId}/requests?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`); }
  revalidatePath(`/${locale}/company/${registrationId}/requests`); redirect(`/${locale}/company/${registrationId}/requests?result=saved`);
}

export async function cancelRequestAction(data:FormData) {
  const locale:Locale=String(data.get("locale")) === "en" ? "en" : "pt", registrationId=String(data.get("registrationId")??"");
  try { const access=await requirePortal(locale,"COMPANY_LEADER"); await cancelCompanyRequest(database(),access.context,String(data.get("requestId")??""),Number(data.get("version"))); }
  catch(error) { if(error && typeof error === "object" && "digest" in error) throw error; redirect(`/${locale}/company/${registrationId}/requests?result=error`); }
  revalidatePath(`/${locale}/company/${registrationId}/requests`); redirect(`/${locale}/company/${registrationId}/requests?result=cancelled`);
}
