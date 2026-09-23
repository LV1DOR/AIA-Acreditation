import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { session } from "../../../server/session.ts";
import { PublicHeader } from "../../../components/public-header.tsx";
import { AccountControls } from "../../../components/account-controls.tsx";
export default async function AccessPage() {
  const locale = await getLocale(), t = await getTranslations("auth");
  const access = await session();
  if (access.status === "UNCONFIGURED" || access.status === "SIGNED_OUT") redirect("/" + locale + "/sign-in");
  if (access.status !== "NO_ACCESS") redirect("/" + locale + "/portal");
  return <><PublicHeader/><main className="auth-page"><h1>{t("noAccessTitle")}</h1><p>{t("noAccessText")}</p><AccountControls/><Link href={"/" + locale + "/invitation"} className="button secondary">{t("invitationTitle")}</Link></main></>;
}

