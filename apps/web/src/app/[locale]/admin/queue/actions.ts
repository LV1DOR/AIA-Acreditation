"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideCompanyRequest, overrideDuplicate } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

export async function overrideDuplicateAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  try {
    const access = await requirePortal(locale, "ADMIN");
    await overrideDuplicate(database(), access.context, String(data.get("participantId") ?? ""));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/queue?result=error`);
  }
  revalidatePath(`/${locale}/admin/queue`);
  redirect(`/${locale}/admin/queue?result=saved`);
}

export async function decideRequestAction(data:FormData) {
  const locale:Locale=String(data.get("locale")) === "en" ? "en" : "pt";
  try { const access=await requirePortal(locale,"ADMIN"); await decideCompanyRequest(database(),access.context,{ requestId:String(data.get("requestId")??""), expectedVersion:Number(data.get("version")), decision:String(data.get("decision")) === "APPROVE" ? "APPROVE":"REJECT", comment:String(data.get("comment")??"") }); }
  catch(error) { if(error && typeof error === "object" && "digest" in error) throw error; redirect(`/${locale}/admin/queue?result=error`); }
  revalidatePath(`/${locale}/admin/queue`); redirect(`/${locale}/admin/queue?result=saved`);
}
