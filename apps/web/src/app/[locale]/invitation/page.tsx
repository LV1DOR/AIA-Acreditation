import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { invitationAvailable } from "@aia/domain";
import { PublicHeader } from "../../../components/public-header.tsx";
import { Notice } from "../../../components/notice.tsx";
import { authConfigured } from "../../../server/auth-config.ts";
import { invitationIdentity } from "../../../server/session.ts";
import { database } from "../../../server/runtime.ts";
import { acceptInvitation, startInvitedSignUp } from "./actions.ts";
export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await getLocale(), t = await getTranslations("auth"), common = await getTranslations("common");
  const configured = authConfigured();
  const token = (await cookies()).get("aia_leader_invitation")?.value;
  const available = configured && Boolean(token) && await invitationAvailable(database(), token ?? "");
  const identity = available ? await invitationIdentity() : null;
  const error = Boolean((await searchParams).error);
  return <><PublicHeader/><main className="auth-page"><h1>{t("invitationTitle")}</h1>
    {!configured ? <Notice title={t("unconfiguredTitle")}><p>{t("unconfiguredText")}</p></Notice> :
     !available ? <Notice title={t("invitationTitle")}><p>{t(error ? "invitationUnavailable" : "invitationMissing")}</p></Notice> :
     identity ? <section className="card"><p>{t("invitationText")}</p><p className="small muted">{t("invitationAccountRule")}</p><form action={acceptInvitation}><input type="hidden" name="locale" value={locale}/><button className="button primary" type="submit">{t("accept")}</button></form></section> :
     <section className="card"><p>{t("invitationText")}</p><div className="actions"><Link className="button primary" href={"/" + locale + "/sign-in"}>{common("signIn")}</Link><form action={startInvitedSignUp}><input type="hidden" name="locale" value={locale}/><button className="button secondary" type="submit">{t("signUp")}</button></form></div></section>}
  </main></>;
}
