import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageSwitch } from "./language-switch.tsx";
import { AccountControls } from "./account-controls.tsx";
import { BrandLogo } from "./brand-logo.tsx";
export async function PublicHeader({ authenticated = false }: { authenticated?: boolean }) {
  const locale = await getLocale(), t = await getTranslations("common");
  return <header className="public-header"><Link href={"/" + locale} className="brand public-logo" aria-label={t("brand")}><BrandLogo label={t("brand")} priority/></Link><div className="header-tools"><LanguageSwitch />{authenticated&&<AccountControls/>}</div></header>;
}
