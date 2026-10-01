import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { ClerkProvider } from "@clerk/nextjs";
import { ptPT, enUS } from "@clerk/localizations";
import { isLocale, messages } from "@aia/i18n";
import { authConfigured } from "../../server/auth-config.ts";
export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const content = <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Lisbon">{children}</NextIntlClientProvider>;
  if (!authConfigured()) return content;
  return <ClerkProvider localization={locale === "pt" ? ptPT : enUS} signInUrl={"/" + locale + "/sign-in"} signUpUrl={"/" + locale + "/sign-up"} signInFallbackRedirectUrl={"/" + locale + "/portal"} signUpFallbackRedirectUrl={"/" + locale + "/portal"} appearance={{ variables: { colorPrimary: "#d41f32", borderRadius: "8px", fontFamily: "Arial, sans-serif" } }}>{content}</ClerkProvider>;
}
