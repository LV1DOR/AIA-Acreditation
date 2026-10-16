"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assignPrimaryLeader, manageLeaderMembership, reinstateRemovedParticipant, DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { database } from "@/server/runtime.ts";
import { requirePortal } from "@/server/session.ts";
export async function membershipAction(data:FormData) {
  const locale:Locale=data.get("locale")==="en"?"en":"pt",registrationId=String(data.get("registrationId")),eventId=String(data.get("eventId"));
  const path=`/${locale}/admin/companies/${registrationId}?eventId=${encodeURIComponent(eventId)}`;
  try {
    const access=await requirePortal(locale,"ADMIN"),membershipId=String(data.get("membershipId")),reason=String(data.get("reason"));
    if(data.get("intent")==="REINSTATE") await reinstateRemovedParticipant(database(),access.context,{participantId:String(data.get("participantId")),expectedVersion:Number(data.get("version")),reason});
    else if(data.get("intent")==="PRIMARY") await assignPrimaryLeader(database(),access.context,{registrationId,membershipId,expectedVersion:Number(data.get("registrationVersion")),reason});
    else await manageLeaderMembership(database(),access.context,{membershipId,expectedVersion:Number(data.get("membershipVersion")),action:String(data.get("intent")) as "REVOKE"|"RESTORE",reason});
  }catch(error){if(error && typeof error==="object" && "digest" in error) throw error;redirect(`${path}&result=${error instanceof DomainError?error.code.toLowerCase():"error"}`);}
  revalidatePath(`/${locale}/admin/companies`);revalidatePath(`/${locale}/admin/companies/${registrationId}`);redirect(`${path}&result=saved`);
}
