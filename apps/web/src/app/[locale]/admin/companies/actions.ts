"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAuthEnv } from "@aia/config";
import { createCompany, createRegistration, issueLeaderInvitation, assertCollectionAllowed, DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

export async function createInvitedCompanyAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const eventId = String(data.get("eventId") ?? "");
  const destination = `/${locale}/admin/companies?eventId=${encodeURIComponent(eventId)}`;
  try {
    const access = await requirePortal(locale, "ADMIN");
    const auth = parseAuthEnv(process.env);
    if (!auth.AUTH_EMAIL_ENCRYPTION_KEY) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
    const input=z.object({eventId:z.uuid(),name:z.string().trim().min(1).max(200),email:z.email()}).parse({
      eventId,name:String(data.get("name")??"").trim(),email:String(data.get("email")??"").trim(),
    });
    // Validate the event's shared notice/policy before persisting the company.
    await assertCollectionAllowed(database(), input.eventId);
    const company = await createCompany(database(), access.context, { name: input.name });
    const registration = await createRegistration(database(), access.context, { eventId, companyId: company.id, personnelLimit: 10 });
    await issueLeaderInvitation(database(), access.context, {
      registrationId: registration.id,
      email: input.email,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      delivery: { appOrigin: auth.APP_ORIGIN, locale, encryptionKey: auth.AUTH_EMAIL_ENCRYPTION_KEY },
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${destination}&result=${error instanceof DomainError?error.code.toLowerCase():"invalid_input"}`);
  }
  revalidatePath(`/${locale}/admin/companies`);
  redirect(`${destination}&result=saved`);
}

/** Issue an invitation for an existing registration without recreating its company. */
export async function inviteExistingCompanyAction(data:FormData) {
  const locale:Locale=data.get("locale")==="en"?"en":"pt";
  const parsed=z.object({registrationId:z.uuid(),email:z.email()}).safeParse({
    registrationId:String(data.get("registrationId")??""),email:String(data.get("email")??"").trim(),
  });
  if(!parsed.success)redirect(`/${locale}/admin/companies?result=invalid_input`);
  let destination=`/${locale}/admin/companies/${parsed.data.registrationId}`;
  try {
    const access=await requirePortal(locale,"ADMIN"),auth=parseAuthEnv(process.env),db=database();
    if(!auth.AUTH_EMAIL_ENCRYPTION_KEY)throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
    const registration=await db.companyEventRegistration.findUniqueOrThrow({where:{id:parsed.data.registrationId},select:{eventId:true}});
    destination+=`?eventId=${encodeURIComponent(registration.eventId)}`;
    const pending=await db.leaderInvitation.count({where:{registrationId:parsed.data.registrationId,
      emailNormalized:parsed.data.email.toLowerCase(),usedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}});
    if(pending)redirect(`${destination}${destination.includes("?")?"&":"?"}result=invitation_pending`);
    await issueLeaderInvitation(db,access.context,{...parsed.data,expiresAt:new Date(Date.now()+7*86400000),
      delivery:{appOrigin:auth.APP_ORIGIN,locale,encryptionKey:auth.AUTH_EMAIL_ENCRYPTION_KEY}});
  }catch(error){
    if(error&&typeof error==="object"&&"digest" in error)throw error;
    redirect(`${destination}${destination.includes("?")?"&":"?"}result=${error instanceof DomainError?error.code.toLowerCase():"invalid_input"}`);
  }
  revalidatePath(`/${locale}/admin/companies`);
  redirect(`${destination}${destination.includes("?")?"&":"?"}result=invitation_queued`);
}
