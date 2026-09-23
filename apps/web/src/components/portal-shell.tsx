import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@aia/i18n";
import { getTranslations } from "next-intl/server";
import { requirePortal } from "../server/session.ts";
import { loadNotifications } from "../server/portal-data.ts";
import { LanguageSwitch } from "./language-switch.tsx";
import { AccountControls } from "./account-controls.tsx";
export async function PortalShell({ locale, role, children }: { locale: Locale; role: "ADMIN" | "COMPANY_LEADER"; children: ReactNode }) {
  await requirePortal(locale, role);
  const t = await getTranslations("portal"), common = await getTranslations("common"), n = await getTranslations("notification");
  const notifications = await loadNotifications(locale);
  const root = "/" + locale + (role === "ADMIN" ? "/admin" : "/company");
  return <div className="portal-shell"><aside className="sidebar"><Link href={"/" + locale} className="brand"><span className="brand-mark">AIA<span> / </span></span><span>{common("brand")}</span></Link>
    <p className="sidebar-label">{t(role === "ADMIN" ? "admin" : "leader")}</p>
    <nav><Link href={root}><span aria-hidden="true">▦</span>{t("overview")}</Link>
      {role === "ADMIN" && <Link href={root + "/queue"}><span aria-hidden="true">◉</span>{t("actionRequired")}</Link>}
      <Link href={"/" + locale + "/security"}><span aria-hidden="true">○</span>{common("account")}</Link>
      {role === "ADMIN" && <><p className="sidebar-label">{t("settings")}</p><Link href={root + "/audit"}><span aria-hidden="true">≡</span>{t("audit")}</Link></>}
    </nav><p className="sidebar-footer">{common("circuit")}</p></aside>
    <div className="portal-body"><header className="portal-header"><span className="workspace-label">{t(role === "ADMIN" ? "admin" : "leader")}</span><div className="header-tools">
      <details className="notification-menu"><summary>{common("notifications")} <span className="counter">{notifications.filter(item => !item.readAt).length}</span></summary><div className="notification-popover">{notifications.length ? notifications.map(item => <p key={item.id}>{n.has(item.type) ? n(item.type) : common("notifications")}</p>) : <p>{common("emptyNotifications")}</p>}</div></details>
      <LanguageSwitch/><AccountControls/></div></header><main className="portal-content">{children}</main></div></div>;
}

