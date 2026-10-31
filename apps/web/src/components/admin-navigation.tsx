"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@aia/i18n";
import type { IconName } from "./portal-icon.tsx";
import { PortalNavigation } from "./portal-navigation.tsx";

const copy = {
  pt: { operations: "Operações", administration: "Administração", overview: "Visão geral", submissions: "Submissões", companies: "Empresas", people: "Pessoas", vehicles: "Veículos", requests: "Pedidos", exports: "Exportações", setup: "Configuração", audit: "Auditoria e segurança" },
  en: { operations: "Operations", administration: "Administration", overview: "Overview", submissions: "Submissions", companies: "Companies", people: "People", vehicles: "Vehicles", requests: "Requests", exports: "Exports", setup: "Setup", audit: "Audit & security" },
} as const;

export function AdminNavigation({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const eventId = useSearchParams().get("eventId");
  const root = `/${locale}/admin`;
  const labels = copy[locale];
  const item = (route: string, label: string, icon: IconName) => ({
    href: `${root}${route}${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ""}`,
    label, icon, active: route ? pathname === `${root}${route}` || pathname.startsWith(`${root}${route}/`) : pathname === root,
  });
  return <PortalNavigation label={locale === "pt" ? "Navegação da administração AIA" : "AIA administration navigation"} sections={[
    { label: labels.operations, items: [
      item("", labels.overview, "home"), item("/submissions", labels.submissions, "finalSubmission"),
      item("/companies", labels.companies, "building"), item("/people", labels.people, "people"), item("/vehicles", labels.vehicles, "car"),
      item("/requests", labels.requests, "requests"), item("/exports", labels.exports, "document"),
    ] },
    { label: labels.administration, items: [item("/setup", labels.setup, "settings"), item("/audit", labels.audit, "shield")] },
  ]}/>;
}
