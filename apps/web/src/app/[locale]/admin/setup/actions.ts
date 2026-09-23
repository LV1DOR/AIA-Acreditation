"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAuthEnv } from "@aia/config";
import {
  activateEventZone, createCompany, createEvent, createRegistration, deactivateEventZone,
  issueLeaderInvitation, jobRoles, revokeLeaderInvitation, updateCompany, updateEvent,
  updatePersonnelLimit, zones,
} from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const integer = (data: FormData, name: string) => Number.parseInt(text(data, name), 10);
const boolean = (data: FormData, name: string) => data.get(name) === "on";
const localeOf = (data: FormData): Locale => text(data, "locale") === "en" ? "en" : "pt";
function done(locale: Locale, result: "saved" | "error") {
  revalidatePath(`/${locale}/admin/setup`);
  redirect(`/${locale}/admin/setup?result=${result}`);
}
async function run(data: FormData, operation: (locale: Locale, context: Awaited<ReturnType<typeof requirePortal>>["context"]) => Promise<unknown>) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    await operation(locale, access.context);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(locale, "error");
  }
  done(locale, "saved");
}

export async function createEventAction(data: FormData) {
  return run(data, (_, context) => createEvent(database(), context, {
    name: text(data, "name"), slug: text(data, "slug") || undefined,
    startDate: text(data, "startDate"), endDate: text(data, "endDate"),
    onboardingOpensAt: text(data, "onboardingOpensAt"), onboardingClosesAt: text(data, "onboardingClosesAt"),
    timezone: text(data, "timezone") || "Europe/Lisbon",
    publicationState: text(data, "publicationState") === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
  }));
}
export async function updateEventAction(data: FormData) {
  return run(data, (_, context) => updateEvent(database(), context, {
    id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"),
    name: text(data, "name"), slug: text(data, "slug") || undefined,
    startDate: text(data, "startDate"), endDate: text(data, "endDate"),
    onboardingOpensAt: text(data, "onboardingOpensAt"), onboardingClosesAt: text(data, "onboardingClosesAt"),
    timezone: text(data, "timezone") || "Europe/Lisbon",
    publicationState: text(data, "publicationState") === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
  }));
}
export async function createZoneAction(data: FormData) {
  return run(data, (_, context) => zones.create(database(), context, { name: text(data, "name") }));
}
export async function updateZoneAction(data: FormData) {
  return run(data, (_, context) => zones.update(database(), context, { id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"), name: text(data, "name"), sortOrder: integer(data, "sortOrder"), active: boolean(data, "active") }));
}
export async function createJobRoleAction(data: FormData) {
  return run(data, (_, context) => jobRoles.create(database(), context, { name: text(data, "name") }));
}
export async function updateJobRoleAction(data: FormData) {
  return run(data, (_, context) => jobRoles.update(database(), context, { id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"), name: text(data, "name"), sortOrder: integer(data, "sortOrder"), active: boolean(data, "active") }));
}
export async function activateEventZoneAction(data: FormData) {
  return run(data, (_, context) => activateEventZone(database(), context, { eventId: text(data, "eventId"), zoneId: text(data, "zoneId") }));
}
export async function deactivateEventZoneAction(data: FormData) {
  return run(data, (_, context) => deactivateEventZone(database(), context, { eventId: text(data, "eventId"), zoneId: text(data, "zoneId") }));
}
export async function createCompanyAction(data: FormData) {
  return run(data, (_, context) => createCompany(database(), context, { name: text(data, "name") }));
}
export async function updateCompanyAction(data: FormData) {
  return run(data, (_, context) => updateCompany(database(), context, { id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"), name: text(data, "name"), active: boolean(data, "active") }));
}
export async function createRegistrationAction(data: FormData) {
  return run(data, (_, context) => createRegistration(database(), context, { eventId: text(data, "eventId"), companyId: text(data, "companyId"), personnelLimit: integer(data, "personnelLimit") }));
}
export async function updatePersonnelLimitAction(data: FormData) {
  return run(data, (_, context) => updatePersonnelLimit(database(), context, { registrationId: text(data, "registrationId"), expectedVersion: integer(data, "expectedVersion"), personnelLimit: integer(data, "personnelLimit") }));
}
export async function issueInvitationAction(data: FormData) {
  return run(data, (locale, context) => {
    const auth = parseAuthEnv(process.env);
    if (!auth.AUTH_EMAIL_ENCRYPTION_KEY) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
    const days = Math.min(30, Math.max(1, integer(data, "expiryDays")));
    return issueLeaderInvitation(database(), context, {
      registrationId: text(data, "registrationId"), email: text(data, "email"),
      expiresAt: new Date(Date.now() + days * 86_400_000),
      delivery: { appOrigin: auth.APP_ORIGIN, locale, encryptionKey: auth.AUTH_EMAIL_ENCRYPTION_KEY },
    });
  });
}
export async function revokeInvitationAction(data: FormData) {
  return run(data, (_, context) => revokeLeaderInvitation(database(), context, text(data, "invitationId")));
}
