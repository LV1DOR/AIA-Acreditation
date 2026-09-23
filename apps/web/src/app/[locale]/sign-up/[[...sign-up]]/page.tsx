import { SignUp } from "@clerk/nextjs";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicHeader } from "../../../../components/public-header.tsx";
import { Notice } from "../../../../components/notice.tsx";
import { authConfigured } from "../../../../server/auth-config.ts";
import { invitationAvailable } from "@aia/domain";
import { database } from "../../../../server/runtime.ts";
export default async function SignUpPage() {
  const locale = await getLocale(), t = await getTranslations("auth");
  const token = (await cookies()).get("aia_leader_invitation")?.value;
  const pending = authConfigured() && Boolean(token) && await invitationAvailable(database(), token ?? "");
  return <><PublicHeader/><main className="auth-page"><h1>{t("signUp")}</h1>
    {!authConfigured() ? <Notice title={t("unconfiguredTitle")}><p>{t("unconfiguredText")}</p></Notice> : pending ? <SignUp routing="path" path={"/" + locale + "/sign-up"} signInUrl={"/" + locale + "/sign-in"} forceRedirectUrl={"/" + locale + "/invitation"} /> : <Notice title={t("noAccessTitle")}><p>{t("invitationMissing")}</p></Notice>}
    <p className="small muted">{t("restricted")}</p></main></>;
}
