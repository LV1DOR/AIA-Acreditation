import Link from "next/link";
import Image from "next/image";
import { Suspense, type ReactNode } from "react";
import type { Locale } from "@aia/i18n";
import { getTranslations } from "next-intl/server";
import { requirePortal } from "../server/session.ts";
import { loadAdminEventOptions, loadLeader, loadNotifications } from "../server/portal-data.ts";
import { LanguageSwitch } from "./language-switch.tsx";
import { AccountControls } from "./account-controls.tsx";
import { LeaderNavigation } from "./leader-navigation.tsx";
import { AdminNavigation } from "./admin-navigation.tsx";
import { AdminEventSwitcher } from "./admin-event-switcher.tsx";
import { PortalRealtime } from "./portal-realtime.tsx";
import { NotificationMenu } from "./notification-menu.tsx";
import { presentNotification } from "../lib/notification-presentation.ts";
import { Separator } from "./ui/separator.tsx";

export async function PortalShell({ locale, role, children }: { locale: Locale; role: "ADMIN" | "COMPANY_LEADER"; children: ReactNode }) {
  await requirePortal(locale, role);
  const t = await getTranslations("portal");
  const common = await getTranslations("common");
  const notificationText = await getTranslations("notification");
  const notifications = await loadNotifications(locale);
  const adminEvents = role === "ADMIN" ? await loadAdminEventOptions(locale) : [];
  const leaderRegistrations = role === "COMPANY_LEADER" ? await loadLeader(locale) : [];
  const leaderCompany = leaderRegistrations[0]?.company.name;
  const unread = notifications.filter(item => !item.readAt).length;

  return <div className={`portal-shell ${role === "COMPANY_LEADER" ? "leader-shell" : "admin-shell"}`}>
    <aside className="sidebar">
      <Link href={`/${locale}`} className="sidebar-logo" aria-label={common("brand")}>
        <Image src="/brand/aia-logo.png" alt={common("brand")} width={820} height={293} priority/>
      </Link>
      {role === "COMPANY_LEADER"
        ? <LeaderNavigation locale={locale} registrationId={leaderRegistrations[0]?.id}/>
        : <Suspense fallback={null}><AdminNavigation locale={locale}/></Suspense>
      }
      <div className="sidebar-footer"><span className="circuit-line" aria-hidden="true"/>{common("circuit")}</div>
    </aside>
    <div className="portal-body">
      <header className="portal-header">
        {role === "ADMIN" && <Suspense fallback={<div className="admin-event-switcher-skeleton" aria-hidden="true"/>}><AdminEventSwitcher locale={locale} events={adminEvents}/></Suspense>}
        <div className="header-tools">
          {role === "ADMIN" && <Separator orientation="vertical" className="header-separator"/>}
          <NotificationMenu unread={unread} label={common("notifications")} title={notificationText("title")} unreadLabel={notificationText("unread")} markAllRead={notificationText("markAllRead")} emptyTitle={notificationText("emptyTitle")} emptyText={notificationText("emptyText")} viewAll={notificationText("viewAll")} allHref={`/${locale}/${role === "ADMIN" ? "admin" : "company"}/notifications`} items={notifications.map(item=>presentNotification(item,locale,role))}/>
          <Separator orientation="vertical" className="header-separator"/>
          <div className="portal-account-group"><span className="portal-account-copy"><strong>{role === "ADMIN" ? t("admin") : leaderCompany ?? t("leader")}</strong><small>{role === "ADMIN" ? (locale === "pt" ? "Administrador" : "Administrator") : (locale === "pt" ? "Responsável da empresa" : "Company leader")}</small></span><AccountControls/></div>
          <Separator orientation="vertical" className="header-separator"/>
          <LanguageSwitch/>
        </div>
      </header>
      <PortalRealtime/><main className="portal-content">{children}</main>
    </div>
  </div>;
}
