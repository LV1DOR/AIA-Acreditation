"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@aia/i18n";
import { PortalIcon } from "./portal-icon.tsx";

type Labels = { overview: string; actionRequired: string; setup: string; account: string; settings: string; audit: string };

export function AdminNavigation({ locale, labels }: { locale: Locale; labels: Labels }) {
  const pathname = usePathname();
  const root = `/${locale}/admin`;
  const links = [
    { href: root, label: labels.overview, icon: "home" as const, exact: true },
    { href: `${root}/queue`, label: labels.actionRequired, icon: "alert" as const },
    { href: `${root}/setup`, label: labels.setup, icon: "settings" as const },
    { href: `/${locale}/security`, label: labels.account, icon: "people" as const },
  ];
  return <>
    <p className="sidebar-label">{locale === "pt" ? "Administração AIA" : "AIA administration"}</p>
    <nav className="admin-nav">
      {links.map(link => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return <Link key={link.href} href={link.href} className={active ? "active" : undefined}><PortalIcon name={link.icon}/><span>{link.label}</span></Link>;
      })}
      <p className="sidebar-label">{labels.settings}</p>
      <Link href={`${root}/audit`} className={pathname.startsWith(`${root}/audit`) ? "active" : undefined}><PortalIcon name="document"/><span>{labels.audit}</span></Link>
    </nav>
  </>;
}
