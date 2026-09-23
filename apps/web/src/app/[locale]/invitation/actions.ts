"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { acceptLeaderInvitation } from "@aia/domain";
import { database } from "../../../server/runtime.ts";
import { invitationIdentity } from "../../../server/session.ts";
export async function acceptInvitation(form: FormData) {
  const locale = form.get("locale") === "en" ? "en" : "pt";
  const identity = await invitationIdentity();
  if (!identity) redirect("/" + locale + "/sign-in");
  const jar = await cookies(), token = jar.get("aia_leader_invitation")?.value;
  let accepted = false;
  if (token) {
    try { await acceptLeaderInvitation(database(), identity, token); accepted = true; }
    catch { /* Never include provider/database errors or token content in the response. */ }
  }
  jar.delete("aia_leader_invitation");
  redirect("/" + locale + (accepted ? "/portal" : "/invitation?error=unavailable"));
}

