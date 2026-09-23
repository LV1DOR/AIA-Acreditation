import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../server/session.ts";
export default async function PortalEntry() {
  const locale = await getLocale() as Locale;
  if ((await cookies()).has("aia_leader_invitation")) redirect("/" + locale + "/invitation");
  const access = await requirePortal(locale);
  redirect("/" + locale + (access.role === "ADMIN" ? "/admin" : "/company"));
}

