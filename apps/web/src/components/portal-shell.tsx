import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@aia/i18n";
import { getTranslations } from "next-intl/server";
import { requirePortal } from "../server/session.ts";
import { loadLeader, loadNotifications } from "../server/portal-data.ts";
import { LanguageSwitch } from "./language-switch.tsx";
import { AccountControls } from "./account-controls.tsx";
import { LeaderNavigation } from "./leader-navigation.tsx";
import { PortalIcon } from "./portal-icon.tsx";

export async function PortalShell({ locale, role, children }: { locale: Locale; role: "ADMIN" | "COMPANY_LEADER"; children: ReactNode }) {
  await requirePortal(locale, role);
  const t = await getTranslations("portal");
  const common = await getTranslations("common");
  const notificationText = await getTranslations("notification");
  const notifications = await loadNotifications(locale);
  const leaderRegistrations = role === "COMPANY_LEADER" ? await loadLeader(locale) : [];
  const leaderCompany = leaderRegistrations[0]?.company.name;
  const root = `/${locale}/${role === "ADMIN" ? "admin" : "company"}`;
  const unread = notifications.filter(item => !item.readAt).length;

  return <div className={`portal-shell ${role === "COMPANY_LEADER" ? "leader-shell" : "admin-shell"}`}>
    <aside className="sidebar">
      <Link href={`/${locale}`} className="brand">
        <span className="brand-mark">AIA<span> / </span></span>
        <span>{role === "COMPANY_LEADER" ? <><strong>ACREDITAÇÃO</strong><small>AUTÓDROMO INTERNACIONAL<br/>DO ALGARVE</small></> : common("brand")}</span>
      </Link>
      {role === "COMPANY_LEADER" ? <LeaderNavigation locale={locale} registrationId={leaderRegistrations[0]?.id}/> : <>
        <p className="sidebar-label">{t("admin")}</p>
        <nav>
          <Link href={root}><span aria-hidden="true">◇</span>{t("overview")}</Link>
          <Link href={`${root}/queue`}><span aria-hidden="true">◉</span>{t("actionRequired")}</Link>
          <Link href={`${root}/setup`}><span aria-hidden="true">+</span>{t("setup")}</Link>
          <Link href={`/${locale}/security`}><span aria-hidden="true">○</span>{common("account")}</Link>
          <p className="sidebar-label">{t("settings")}</p>
          <Link href={`${root}/audit`}><span aria-hidden="true">≡</span>{t("audit")}</Link>
        </nav>
      </>}
      <div className="sidebar-footer"><span className="circuit-line" aria-hidden="true"/>{common("circuit")}<small>A HIGHER LEVEL</small></div>
    </aside>
    <div className="portal-body">
      <header className="portal-header">
        <span className="workspace-label">{role === "ADMIN" ? t("admin") : ""}</span>
        <div className="header-tools">
          <LanguageSwitch/>
          <details className="notification-menu"><summary aria-label={common("notifications")}><PortalIcon name="bell"/><span className="counter">{unread}</span></summary><div className="notification-popover">{notifications.length ? notifications.map(item => <p key={item.id}>{notificationText.has(item.type) ? notificationText(item.type) : common("notifications")}</p>) : <p>{common("emptyNotifications")}</p>}</div></details>
          {role === "COMPANY_LEADER" && <span className="leader-account-copy"><strong>{leaderCompany ?? t("leader")}</strong><small>Company Leader</small></span>}
          <AccountControls/>
        </div>
      </header>
      <main className="portal-content">{children}</main>
    </div>
  </div>;
}
