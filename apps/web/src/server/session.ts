import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { portalAccess, recordSessionAccess, leaderSelfProfiles } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { database } from "./runtime.ts";
import { authConfigured } from "./auth-config.ts";

export const session = cache(async () => {
  if (!authConfigured()) return { status: "UNCONFIGURED" as const };
  const identity = await auth({ acceptsToken: "session_token" });
  if (!identity.userId || !identity.sessionId) return { status: "SIGNED_OUT" as const };
  const context = { clerkUserId: identity.userId, correlationId: randomUUID() };
  const access = await portalAccess(database(), context);
  return { ...access, context, sessionId: identity.sessionId };
});
export async function requirePortal(locale: Locale, role?: "ADMIN" | "COMPANY_LEADER", options: { allowIncompleteLeaderProfile?: boolean } = {}) {
  const access = await session();
  if (access.status === "UNCONFIGURED" || access.status === "SIGNED_OUT") redirect("/" + locale + "/sign-in");
  if (access.status === "NO_ACCESS") redirect("/" + locale + "/access");
  if (role && access.role !== role) redirect("/" + locale + "/portal");
  await recordSessionAccess(database(), access.context, access.sessionId);
  if (access.role === "COMPANY_LEADER" && !options.allowIncompleteLeaderProfile) {
    const pending = (await leaderSelfProfiles(database(), access.context)).find(row => row.required);
    if (pending) redirect(`/${locale}/my-details?registrationId=${pending.registrationId}`);
  }
  return access;
}
export async function invitationIdentity() {
  if (!authConfigured()) return null;
  const identity = await auth({ acceptsToken: "session_token" });
  if (!identity.userId) return null;
  const user = await currentUser();
  if (!user || user.id !== identity.userId) return null;
  return { clerkUserId: identity.userId, verifiedEmails: user.emailAddresses.filter(email => email.verification?.status === "verified").map(email => email.emailAddress), correlationId: randomUUID() };
}
