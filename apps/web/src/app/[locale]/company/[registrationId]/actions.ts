"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveParticipant, configureRegistration, createParticipant, createParticipantWithInvitation, DomainError, leaderRegistration, removeParticipant, revokeEmployeeInvitation } from "@aia/domain";
import { parseAuthEnv, parseStorageEnv } from "@aia/config";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

export async function configureRegistrationAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    const current=await leaderRegistration(database(),access.context,registrationId,parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY);
    if(!current.capabilities.zones && !data.has("zoneIds")) for(const zone of current.zones) data.append("zoneIds",zone.zoneId);
    if(!current.capabilities.vehicle) {if(current.vehiclePass?.required)data.set("vehicleRequired","on");data.set("requestedQuantity",String(current.vehiclePass?.requestedQuantity??0));data.set("justification",current.vehiclePass?.justification??"");}
    const required = data.get("vehicleRequired") === "on";
    await configureRegistration(database(), access.context, {
      registrationId,
      expectedVersion: Number.parseInt(String(data.get("expectedVersion")), 10),
      zoneIds: data.getAll("zoneIds").map(String),
      vehicle: required
        ? {
            required: true,
            requestedQuantity: Number.parseInt(String(data.get("requestedQuantity")), 10),
            justification: String(data.get("justification") ?? "").trim(),
          }
        : { required: false, requestedQuantity: 0, justification: null },
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const result = error instanceof DomainError ? error.code.toLowerCase() : "error";
    redirect(`/${locale}/company/${registrationId}?result=${result}`);
  }
  revalidatePath(`/${locale}/company`);
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(`/${locale}/company/${registrationId}?result=saved`);
}

export async function createParticipantAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    const participant = await createParticipant(database(), access.context, registrationId);
    revalidatePath(`/${locale}/company/${registrationId}`);
    redirect(`/${locale}/company/${registrationId}/participants/${participant.id}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/company/${registrationId}?result=error`);
  }
  redirect(`/${locale}/company/${registrationId}?result=error`);
}

export type NewParticipantLinkState = { link?: string; participantId?: string; error?: string };
export async function createParticipantLinkAction(_previous: NewParticipantLinkState, data: FormData): Promise<NewParticipantLinkState> {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    const invitation = await createParticipantWithInvitation(database(), access.context, registrationId, new Date(Date.now() + 7 * 86_400_000));
    revalidatePath(`/${locale}/company/${registrationId}`);
    return { participantId: invitation.participantId, link: `${parseAuthEnv(process.env).APP_ORIGIN}/${locale}/onboarding/${invitation.token}` };
  } catch (error) {
    return { error: error instanceof DomainError ? error.code.toLowerCase() : "error" };
  }
}

export async function approveParticipantFromTeamAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    await approveParticipant(database(), access.context, String(data.get("participantId") ?? ""));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/company/${registrationId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(`/${locale}/company/${registrationId}?result=saved`);
}

export async function removeParticipantAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    await removeParticipant(database(), access.context, String(data.get("participantId") ?? ""));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/company/${registrationId}?result=${error instanceof DomainError ? error.code.toLowerCase() : "error"}`);
  }
  revalidatePath(`/${locale}/company`);
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(`/${locale}/company/${registrationId}?result=removed`);
}

export async function revokeEmployeeLinkAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    await revokeEmployeeInvitation(database(), access.context, String(data.get("invitationId") ?? ""));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/company/${registrationId}?result=error`);
  }
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(`/${locale}/company/${registrationId}?result=saved`);
}
