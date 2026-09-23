import { SignIn } from "@clerk/nextjs";
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { PublicHeader } from "../../../../components/public-header.tsx";
import { Notice } from "../../../../components/notice.tsx";
import { authConfigured } from "../../../../server/auth-config.ts";
export default async function SignInPage() {
  const locale = await getLocale(), t = await getTranslations("auth");
  const pendingInvitation = Boolean((await cookies()).get("aia_leader_invitation"));
  return <><PublicHeader/><main className="auth-page"><div className="auth-heading"><p className="eyebrow">AIA / ACCESS</p><h1>{t("title")}</h1><p>{t("subtitle")}</p></div>
    {authConfigured() ? <SignIn routing="path" path={"/" + locale + "/sign-in"} signUpUrl={"/" + locale + "/sign-up"} forceRedirectUrl={"/" + locale + (pendingInvitation ? "/invitation" : "/portal")} /> : <Notice title={t("unconfiguredTitle")}><p>{t("unconfiguredText")}</p></Notice>}
    <p className="small muted">{t("restricted")}</p></main></>;
}

