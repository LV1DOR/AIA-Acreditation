"use client";

import { usePathname } from "next/navigation";
import { PortalNavigation } from "./portal-navigation.tsx";

export function LeaderNavigation({ locale, registrationId }: { locale: "pt" | "en"; registrationId?: string }) {
  const pathname = usePathname();
  const root = `/${locale}/company`;
  const workers = registrationId ? `${root}/${registrationId}#workers` : root;
  const submission = registrationId ? `${root}/${registrationId}/submission` : root;
  const requests = registrationId ? `${root}/${registrationId}/requests` : root;
  const items = [
    { icon: "home" as const, pt: "Visão geral", en: "Overview", href: root, active: pathname === root },
    { icon: "people" as const, pt: "Os meus dados", en: "My details", href: `/${locale}/my-details${registrationId ? `?registrationId=${registrationId}` : ""}`, active: pathname.includes("/my-details") },
    { icon: "people" as const, pt: "Trabalhadores", en: "Workers", href: workers, active: pathname !== root && pathname.includes("/company/") && !pathname.includes("/submission") && !pathname.includes("/requests") },
    { icon: "finalSubmission" as const, pt: "Submissão final", en: "Final submission", href: submission, active: pathname.includes("/submission") },
    { icon: "requests" as const, pt: "Pedidos", en: "Requests", href: requests, active: pathname.includes("/requests") },
  ];
  return <PortalNavigation label={locale === "pt" ? "Navegação da empresa" : "Company navigation"} items={items.map(item => ({ href:item.href, icon:item.icon, label:item[locale], active:item.active, unavailableLabel:locale === "pt" ? "Disponível numa fase futura" : "Available in a future phase" }))}/>;
}
