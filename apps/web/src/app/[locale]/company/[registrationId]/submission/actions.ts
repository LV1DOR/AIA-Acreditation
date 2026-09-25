"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError, reopenApprovedRegistration, submitCompanyRegistration } from "@aia/domain";
import { parseStorageEnv } from "@aia/config";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../../server/session.ts";
import { database } from "../../../../../server/runtime.ts";

function destination(locale: Locale, registrationId: string, result: string) {
  return `/${locale}/company/${registrationId}/submission?result=${result}`;
}

export async function submitRegistrationAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    await submitCompanyRegistration(database(), access.context, { registrationId, expectedVersion: Number(data.get("expectedVersion")) }, parseStorageEnv(process.env).DOCUMENT_ENCRYPTION_KEY);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(destination(locale, registrationId, error instanceof DomainError ? error.code.toLowerCase() : "error"));
  }
  revalidatePath(`/${locale}/company`);
  revalidatePath(`/${locale}/company/${registrationId}`);
  revalidatePath(`/${locale}/admin/queue`);
  redirect(destination(locale, registrationId, "submitted"));
}

export async function reopenRegistrationAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const registrationId = String(data.get("registrationId") ?? "");
  try {
    const access = await requirePortal(locale, "COMPANY_LEADER");
    await reopenApprovedRegistration(database(), access.context, { registrationId, expectedVersion: Number(data.get("expectedVersion")) });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(destination(locale, registrationId, error instanceof DomainError ? error.code.toLowerCase() : "error"));
  }
  revalidatePath(`/${locale}/company`);
  revalidatePath(`/${locale}/company/${registrationId}`);
  redirect(destination(locale, registrationId, "reopened"));
}
