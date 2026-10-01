"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideVehiclePass } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { requirePortal } from "../../../../server/session.ts";
import { database } from "../../../../server/runtime.ts";

export async function decideVehicleAction(data: FormData) {
  const locale: Locale = String(data.get("locale")) === "en" ? "en" : "pt";
  const eventId = String(data.get("eventId") ?? "");
  const query = /^[0-9a-f-]{36}$/i.test(eventId) ? `?eventId=${encodeURIComponent(eventId)}` : "";
  try {
    const access = await requirePortal(locale, "ADMIN");
    await decideVehiclePass(database(), access.context, {
      vehiclePassId: String(data.get("vehiclePassId") ?? ""), expectedVersion: Number(data.get("version")),
      decision: String(data.get("decision")) === "APPROVE" ? "APPROVE" : "REJECT",
      comment: String(data.get("comment") ?? "").trim(),
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/admin/vehicles${query}${query ? "&" : "?"}result=error`);
  }
  revalidatePath(`/${locale}/admin/vehicles`);
  redirect(`/${locale}/admin/vehicles${query}${query ? "&" : "?"}result=saved`);
}
