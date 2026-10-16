"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAuthEnv } from "@aia/config";
import {
  activateEventZone, adminEventBannerAccess, createCompany, createEvent, createRegistration, deactivateEventZone, DomainError,
  issueLeaderInvitation, jobRoles, revokeLeaderInvitation, updateCompany, updateEvent,
  updateEventBanner, updatePersonnelLimit, zones,
} from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";
import { storeEventBanner } from "../../../../server/event-banner.ts";
import { objectStorage } from "../../../../server/storage.ts";

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const integer = (data: FormData, name: string) => Number.parseInt(text(data, name), 10);
const boolean = (data: FormData, name: string) => data.get(name) === "on";
const localeOf = (data: FormData): Locale => text(data, "locale") === "en" ? "en" : "pt";
function returnPath(data: FormData, locale: Locale) {
  const requested = text(data, "returnTo");
  return requested.startsWith(`/${locale}/admin/setup`) ? requested : `/${locale}/admin/setup`;
}
function done(data: FormData, locale: Locale, result: "saved" | "error" | "in_use") {
  revalidatePath(`/${locale}/admin/setup`);
  const destination = returnPath(data, locale);
  redirect(`${destination}${destination.includes("?") ? "&" : "?"}result=${result}`);
}
async function run(data: FormData, operation: (locale: Locale, context: Awaited<ReturnType<typeof requirePortal>>["context"]) => Promise<unknown>) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    await operation(locale, access.context);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(data, locale, "error");
  }
  done(data, locale, "saved");
}

const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function createWizardEventAction(data: FormData) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    const name = text(data, "name");
    const event = await createEvent(database(), access.context, {
      name,
      slug: slugify(name) || undefined,
      startDate: text(data, "startDate"), endDate: text(data, "endDate"),
      onboardingOpensAt: text(data, "onboardingOpensAt"), onboardingClosesAt: text(data, "onboardingClosesAt"),
      timezone: "Europe/Lisbon", publicationState: "DRAFT",
    });
    revalidatePath(`/${locale}/admin/setup`);
    redirect(`/${locale}/admin/setup?wizard=create&step=2&eventId=${event.id}&created=1&result=saved`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/setup?wizard=create&step=1&result=error`);
  }
}

export async function createWizardZoneAction(data: FormData) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    const zone = await zones.create(database(), access.context, { name: text(data, "name") });
    await activateEventZone(database(), access.context, { eventId: text(data, "eventId"), zoneId: zone.id });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(data, locale, "error");
  }
  done(data, locale, "saved");
}

export async function createWizardCompanyAction(data: FormData) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    const company = await createCompany(database(), access.context, { name: text(data, "name") });
    const registration = await createRegistration(database(), access.context, { eventId: text(data, "eventId"), companyId: company.id, personnelLimit: 10 });
    const email = text(data, "email");
    if (email) {
      const auth = parseAuthEnv(process.env);
      if (!auth.AUTH_EMAIL_ENCRYPTION_KEY) throw new Error("AUTH_EMAIL_NOT_CONFIGURED");
      await issueLeaderInvitation(database(), access.context, {
        registrationId: registration.id, email,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        delivery: { appOrigin: auth.APP_ORIGIN, locale, encryptionKey: auth.AUTH_EMAIL_ENCRYPTION_KEY },
      });
    }
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(data, locale, "error");
  }
  done(data, locale, "saved");
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
export async function updateEventBannerAction(data: FormData) {
  const locale = localeOf(data);
  let uploadedKey: string | null = null;
  try {
    const access = await requirePortal(locale, "ADMIN");
    const eventId = text(data, "eventId");
    let previousKey: string | null = null;
    try { previousKey = await adminEventBannerAccess(database(), access.context, eventId); } catch { previousKey = null; }
    const remove = boolean(data, "remove");
    const file = data.get("banner");
    if (!remove && file instanceof File && file.size) uploadedKey = await storeEventBanner(eventId, file);
    const nextKey = remove ? null : uploadedKey ?? previousKey;
    if (!remove && !nextKey) throw new Error("BANNER_REQUIRED");
    await updateEventBanner(database(), access.context, { id: eventId, expectedVersion: integer(data, "expectedVersion"), objectKey: nextKey });
    if (previousKey && previousKey !== nextKey) await objectStorage().deletePhoto(previousKey).catch(() => undefined);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (uploadedKey) await objectStorage().deletePhoto(uploadedKey).catch(() => undefined);
    done(data, locale, "error");
  }
  done(data, locale, "saved");
}
export async function createZoneAction(data: FormData) {
  return run(data, (_, context) => zones.create(database(), context, { name: text(data, "name") }));
}
export async function updateZoneAction(data: FormData) {
  return run(data, (_, context) => zones.update(database(), context, { id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"), name: text(data, "name"), sortOrder: integer(data, "sortOrder"), active: boolean(data, "active") }));
}
export async function deleteZoneAction(data: FormData) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    await zones.delete(database(), access.context, { id: text(data, "id") });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(data, locale, error instanceof DomainError && error.code === "CATALOGUE_IN_USE" ? "in_use" : "error");
  }
  done(data, locale, "saved");
}
export async function createJobRoleAction(data: FormData) {
  return run(data, (_, context) => jobRoles.create(database(), context, { name: text(data, "name") }));
}
export async function updateJobRoleAction(data: FormData) {
  return run(data, (_, context) => jobRoles.update(database(), context, { id: text(data, "id"), expectedVersion: integer(data, "expectedVersion"), name: text(data, "name"), sortOrder: integer(data, "sortOrder"), active: boolean(data, "active") }));
}
export async function deleteJobRoleAction(data: FormData) {
  const locale = localeOf(data);
  try {
    const access = await requirePortal(locale, "ADMIN");
    await jobRoles.delete(database(), access.context, { id: text(data, "id") });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    done(data, locale, error instanceof DomainError && error.code === "CATALOGUE_IN_USE" ? "in_use" : "error");
  }
  done(data, locale, "saved");
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
