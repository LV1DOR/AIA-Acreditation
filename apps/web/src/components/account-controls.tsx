"use client";
import { SignOutButton, UserButton } from "@clerk/nextjs";
import { useTranslations, useLocale } from "next-intl";
export function AccountControls() {
  const t = useTranslations("common"), locale = useLocale();
  return <div className="account-controls"><UserButton /><SignOutButton redirectUrl={"/" + locale}><button className="text-button">{t("logout")}</button></SignOutButton></div>;
}

