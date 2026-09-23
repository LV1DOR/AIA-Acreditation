"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { configureRegistration, createParticipant, issueEmployeeInvitation, revokeEmployeeInvitation } from "@aia/domain";
import { parseAuthEnv } from "@aia/config";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

export async function configureRegistrationAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
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
    redirect(`/${locale}/company/${registrationId}?result=error`);
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
    await createParticipant(database(), access.context, registrationId);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/company/${registrationId}?result=error`);
  }
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(`/${locale}/company/${registrationId}?result=saved`);
}

export type EmployeeLinkState = { link?: string; error?: boolean };
export async function createEmployeeLinkAction(_previous: EmployeeLinkState, data: FormData): Promise<EmployeeLinkState> {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const participantId = String(data.get("participantId") ?? "");
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    const invitation = await issueEmployeeInvitation(database(), access.context, participantId, new Date(Date.now() + 7 * 86_400_000));
    const origin = parseAuthEnv(process.env).APP_ORIGIN;
    revalidatePath(`/${locale}/company/${registrationId}`);
    return { link: `${origin}/${locale}/onboarding/${invitation.token}` };
  } catch { return { error: true }; }
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
