"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PortalIcon } from "./portal-icon.tsx";

export function LeaderNavigation({ locale, registrationId }: { locale: "pt" | "en"; registrationId?: string }) {
  const pathname = usePathname();
  const root = `/${locale}/company`;
  const workers = registrationId ? `${root}/${registrationId}#workers` : root;
  const submission = registrationId ? `${root}/${registrationId}/submission` : root;
  const items = [
    { icon: "home" as const, pt: "Visão Geral", en: "Overview", href: root, active: pathname === root },
    { icon: "people" as const, pt: "Trabalhadores", en: "Workers", href: workers, active: pathname !== root && pathname.includes("/company/") && !pathname.includes("/submission") },
    { icon: "document" as const, pt: "Submissão Final", en: "Final Submission", href: submission, active: pathname.includes("/submission") },
    { icon: "car" as const, pt: "Pedidos", en: "Requests" },
    { icon: "bell" as const, pt: "Notificações", en: "Notifications" },
    { icon: "help" as const, pt: "Ajuda", en: "Help" },
  ];
  return <nav className="leader-nav" aria-label={locale === "pt" ? "Navegação da empresa" : "Company navigation"}>
    {items.map(item => item.href ? <Link key={item.en} href={item.href} className={item.active ? "active" : undefined}>
      <PortalIcon name={item.icon}/><span><strong>{item[locale]}</strong></span>
    </Link> : <span key={item.en} className="nav-disabled" aria-disabled="true" title={locale === "pt" ? "Disponível numa fase futura" : "Available in a future phase"}>
      <PortalIcon name={item.icon}/><span><strong>{item[locale]}</strong></span>
    </span>)}
  </nav>;
}
