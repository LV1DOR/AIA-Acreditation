import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@aia/i18n";
import { getTranslations } from "next-intl/server";
import { requirePortal } from "../server/session.ts";
import { loadLeader, loadNotifications } from "../server/portal-data.ts";
import { LanguageSwitch } from "./language-switch.tsx";
import { AccountControls } from "./account-controls.tsx";
import { LeaderNavigation } from "./leader-navigation.tsx";
import { AdminNavigation } from "./admin-navigation.tsx";
import { PortalRealtime } from "./portal-realtime.tsx";
import { NotificationMenu } from "./notification-menu.tsx";

export async function PortalShell({ locale, role, children }: { locale: Locale; role: "ADMIN" | "COMPANY_LEADER"; children: ReactNode }) {
  await requirePortal(locale, role);
  const t = await getTranslations("portal");
  const common = await getTranslations("common");
  const notificationText = await getTranslations("notification");
  const notifications = await loadNotifications(locale);
  const leaderRegistrations = role === "COMPANY_LEADER" ? await loadLeader(locale) : [];
  const leaderCompany = leaderRegistrations[0]?.company.name;
  const unread = notifications.filter(item => !item.readAt).length;

  return <div className={`portal-shell ${role === "COMPANY_LEADER" ? "leader-shell" : "admin-shell"}`}>
    <aside className="sidebar">
      <Link href={`/${locale}`} className="brand">
        <span className="brand-mark">AIA<span> / </span></span>
        <span>{role === "COMPANY_LEADER" ? <><strong>ACREDITAÇÃO</strong><small>AUTÓDROMO INTERNACIONAL<br/>DO ALGARVE</small></> : common("brand")}</span>
      </Link>
      {role === "COMPANY_LEADER"
        ? <LeaderNavigation locale={locale} registrationId={leaderRegistrations[0]?.id}/>
        : <AdminNavigation locale={locale} labels={{ overview:t("overview"), actionRequired:t("actionRequired"), setup:t("setup"), account:common("account"), settings:t("settings"), audit:t("audit") }}/>
      }
      <div className="sidebar-footer"><span className="circuit-line" aria-hidden="true"/>{common("circuit")}<small>{locale === "pt" ? "UM NÍVEL ACIMA" : "A HIGHER LEVEL"}</small></div>
    </aside>
    <div className="portal-body">
      <header className="portal-header">
        <span className="workspace-label">{role === "ADMIN" ? t("admin") : ""}</span>
        <div className="header-tools">
          <LanguageSwitch/>
          <NotificationMenu unread={unread} label={common("notifications")} empty={common("emptyNotifications")} items={notifications.map(item => ({ id: item.id, text: notificationText.has(item.type) ? notificationText(item.type) : common("notifications") }))}/>
          {role === "COMPANY_LEADER" && <span className="leader-account-copy"><strong>{leaderCompany ?? t("leader")}</strong><small>{locale === "pt" ? "Responsável da empresa" : "Company leader"}</small></span>}
          <AccountControls/>
        </div>
      </header>
      <PortalRealtime/><main className="portal-content">{children}</main>
    </div>
  </div>;
}
