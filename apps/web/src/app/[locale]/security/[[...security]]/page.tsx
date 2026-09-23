import Link from "next/link";
import { UserProfile } from "@clerk/nextjs";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { session } from "../../../../server/session.ts";
import { PublicHeader } from "../../../../components/public-header.tsx";
import { AccountControls } from "../../../../components/account-controls.tsx";
export default async function SecurityPage() {
  const locale = await getLocale(), t = await getTranslations("auth");
  const access = await session();
  if (access.status === "UNCONFIGURED" || access.status === "SIGNED_OUT") redirect("/" + locale + "/sign-in");
  return <><PublicHeader/><main className="security-page"><h1>{t("accountTitle")}</h1>
    <div className="actions"><Link href={"/" + locale + "/portal"} className="button secondary">{t("retry")}</Link><AccountControls/></div>
    <UserProfile routing="path" path={"/" + locale + "/security"}/>
  </main></>;
}
