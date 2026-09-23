import "server-only";
import { adminOverview, leaderOverview, auditOverview, notificationOverview } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "./session.ts";
import { database } from "./runtime.ts";
export async function loadAdmin(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return adminOverview(database(), access.context);
}
export async function loadLeader(locale: Locale) {
  const access = await requirePortal(locale, "COMPANY_LEADER");
  return leaderOverview(database(), access.context);
}
export async function loadAudit(locale: Locale) {
  const access = await requirePortal(locale, "ADMIN");
  return auditOverview(database(), access.context);
}
export async function loadNotifications(locale: Locale) {
  const access = await requirePortal(locale);
  return notificationOverview(database(), access.context);
}

