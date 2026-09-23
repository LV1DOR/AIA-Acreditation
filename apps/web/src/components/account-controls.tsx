"use client";
import { SignOutButton, UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
export function AccountControls() {
  const t = useTranslations("common"), locale = useLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return <div className="account-controls">
    {mounted ? <UserButton /> : <span className="account-avatar-placeholder" aria-hidden="true" />}
    <SignOutButton redirectUrl={"/" + locale}><button className="text-button">{t("logout")}</button></SignOutButton>
  </div>;
}
