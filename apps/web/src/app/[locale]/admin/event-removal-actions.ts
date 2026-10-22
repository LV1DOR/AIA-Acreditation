"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError, removeCompanyFromEvent, removePersonFromEvent } from "@aia/domain";
import { requirePortal } from "../../../server/session.ts";
import { database } from "../../../server/runtime.ts";

async function remove(data: FormData, kind: "company" | "person") {
  const locale = data.get("locale") === "en" ? "en" : "pt";
  const eventId = String(data.get("eventId") ?? "");
  const target = `/${locale}/admin/${kind === "company" ? "companies" : "people"}?eventId=${encodeURIComponent(eventId)}`;
  let result = "removed";
  try {
    const access = await requirePortal(locale, "ADMIN");
    await (kind === "company" ? removeCompanyFromEvent : removePersonFromEvent)(database(), access.context, {
      id: String(data.get(kind === "company" ? "registrationId" : "participantId") ?? ""), eventId,
      expectedVersion: Number(data.get("expectedVersion")),
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    result = error instanceof DomainError && error.code === "STALE_WRITE" ? "stale" : "error";
  }
  if (result === "removed") {
    revalidatePath(`/${locale}/admin`, "layout");
    revalidatePath(`/${locale}/company`, "layout");
    revalidatePath(`/${locale}/portal`);
  }
  redirect(`${target}&result=${result}`);
}
export async function removeCompanyFromEventAction(data: FormData) { return remove(data, "company"); }
export async function removePersonFromEventAction(data: FormData) { return remove(data, "person"); }
