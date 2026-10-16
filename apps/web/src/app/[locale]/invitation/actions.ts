"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { acceptLeaderInvitation, invitationSignupTarget } from "@aia/domain";
import { parseAuthEnv } from "@aia/config";
import { database } from "../../../server/runtime.ts";
import { invitationIdentity } from "../../../server/session.ts";
import { enforcePublicRequestLimit, enforcePublicRateLimit } from "../../../server/rate-limit.ts";
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

export async function startInvitedSignUp(form: FormData) {
  const locale = form.get("locale") === "en" ? "en" : "pt";
  const token = (await cookies()).get("aia_leader_invitation")?.value;
  if (!token) redirect(`/${locale}/invitation?error=unavailable`);
  try {
    await enforcePublicRequestLimit("invitation-start");
    const target = await invitationSignupTarget(database(), token);
    await enforcePublicRateLimit("invitation-ticket", token, 5, 900);
    const environment = parseAuthEnv(process.env);
    const remainingDays = Math.max(1, Math.min(30, Math.ceil((target.expiresAt.getTime() - Date.now()) / 86_400_000)));
    const invitation = await (await clerkClient()).invitations.createInvitation({
      emailAddress: target.emailNormalized,
      expiresInDays: remainingDays,
      ignoreExisting: true,
      notify: false,
      redirectUrl: `${environment.APP_ORIGIN}/${locale}/sign-up`,
    });
    if (!invitation.url) throw new Error("CLERK_INVITATION_URL_MISSING");
    redirect(invitation.url);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/${locale}/invitation?error=unavailable`);
  }
}
