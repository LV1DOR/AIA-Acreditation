import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageSwitch } from "./language-switch.tsx";
export async function PublicHeader() {
  const locale = await getLocale(), t = await getTranslations("common");
  return <header className="public-header"><Link href={"/" + locale} className="brand"><span className="brand-mark">AIA<span> / </span></span><span>{t("brand")}</span></Link><LanguageSwitch /></header>;
}

