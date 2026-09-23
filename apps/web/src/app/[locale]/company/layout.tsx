import type { ReactNode } from "react";
import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { PortalShell } from "../../../components/portal-shell.tsx";
export default async function CompanyLayout({ children }: { children: ReactNode }) {
  return <PortalShell locale={await getLocale() as Locale} role="COMPANY_LEADER">{children}</PortalShell>;
}

