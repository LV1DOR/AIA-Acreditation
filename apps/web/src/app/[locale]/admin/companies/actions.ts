"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAuthEnv } from "@aia/config";
import { createCompany, createRegistration, issueLeaderInvitation } from "@aia/domain";
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
    const company = await createCompany(database(), access.context, { name: String(data.get("name") ?? "").trim() });
    const registration = await createRegistration(database(), access.context, { eventId, companyId: company.id, personnelLimit: 10 });
    await issueLeaderInvitation(database(), access.context, {
      registrationId: registration.id,
      email: String(data.get("email") ?? "").trim(),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      delivery: { appOrigin: auth.APP_ORIGIN, locale, encryptionKey: auth.AUTH_EMAIL_ENCRYPTION_KEY },
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${destination}&result=error`);
  }
  revalidatePath(`/${locale}/admin/companies`);
  redirect(`${destination}&result=saved`);
}
