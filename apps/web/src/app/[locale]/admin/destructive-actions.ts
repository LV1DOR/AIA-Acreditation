"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError, permanentlyDeleteCompany, permanentlyDeleteParticipant } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../server/session.ts";
import { database } from "../../../server/runtime.ts";
import { objectStorage } from "../../../server/storage.ts";

const text = (data: FormData, name: string) => String(data.get(name) ?? "");
const localeOf = (data: FormData): Locale => text(data, "locale") === "en" ? "en" : "pt";
async function deletePhotos(keys: string[]) {
  try {
    const storage = objectStorage();
    await Promise.allSettled([...new Set(keys)].map(key => storage.deletePhoto(key)));
  } catch { /* Database deletion remains authoritative if storage is unavailable. */ }
}

export async function permanentlyDeleteParticipantAction(data: FormData) {
  const locale = localeOf(data), eventId = text(data, "eventId");
  try {
    const access = await requirePortal(locale, "ADMIN");
    const result = await permanentlyDeleteParticipant(database(), access.context, { id: text(data, "participantId") });
    await deletePhotos(result.photoObjectKeys);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (error instanceof DomainError && error.code === "SNAPSHOT_WORKFLOW_REQUIRED") redirect(`/${locale}/admin/people?eventId=${encodeURIComponent(eventId)}&result=history_retained`);
    redirect(`/${locale}/admin/people?eventId=${encodeURIComponent(eventId)}&result=error`);
  }
  revalidatePath(`/${locale}/admin`);
  redirect(`/${locale}/admin/people?eventId=${encodeURIComponent(eventId)}&result=deleted`);
}

export async function permanentlyDeleteCompanyAction(data: FormData) {
  const locale = localeOf(data), eventId = text(data, "eventId");
  try {
    const access = await requirePortal(locale, "ADMIN");
    const result = await permanentlyDeleteCompany(database(), access.context, { id: text(data, "companyId") });
    await deletePhotos(result.photoObjectKeys);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (error instanceof DomainError && error.code === "APPROVED_COMPANY_DELETE_FORBIDDEN") {
      redirect(`/${locale}/admin/companies?eventId=${encodeURIComponent(eventId)}&result=approved_company`);
    }
    if (error instanceof DomainError && error.code === "SNAPSHOT_WORKFLOW_REQUIRED") redirect(`/${locale}/admin/companies?eventId=${encodeURIComponent(eventId)}&result=history_retained`);
    redirect(`/${locale}/admin/companies?eventId=${encodeURIComponent(eventId)}&result=error`);
  }
  revalidatePath(`/${locale}/admin`);
  redirect(`/${locale}/admin/companies?eventId=${encodeURIComponent(eventId)}&result=deleted`);
}
