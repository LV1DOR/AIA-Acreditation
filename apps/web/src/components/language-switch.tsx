"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
export function LanguageSwitch() {
  const pathname = usePathname();
  return <nav aria-label="Idioma / Language" className="languages">{(["pt", "en"] as const).map(locale =>
    <Link key={locale} href={pathname.replace(/^\/(pt|en)(?=\/|$)/, "/" + locale)} hrefLang={locale} aria-current={pathname.startsWith("/" + locale) ? "page" : undefined}>{locale.toUpperCase()}</Link>
  )}</nav>;
}

