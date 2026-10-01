import type { Locale } from "@aia/i18n";
import { getTranslations } from "next-intl/server";
import { loadNotifications } from "../server/portal-data.ts";
import { presentNotification } from "../lib/notification-presentation.ts";
import { NotificationItem } from "./notification-item.tsx";
import { PortalIcon } from "./portal-icon.tsx";
import { MarkAllNotificationsRead } from "./mark-all-notifications-read.tsx";

export async function NotificationsPage({locale,role}:{locale:Locale;role:"ADMIN"|"COMPANY_LEADER"}){
  const t=await getTranslations("notification");
  const items=(await loadNotifications(locale)).map(item=>presentNotification(item,locale,role));
  const unread=items.filter(item=>item.unread).length;
  return <div className="notifications-page"><div className="notifications-heading"><div><h1>{t("pageTitle")}</h1><p>{t("pageIntro")}</p></div><div className="notifications-count"><span><PortalIcon name="bell"/></span><strong>{unread}</strong><small>{t("unread")}</small></div></div><section className="notifications-card"><header><div><h2>{t("recent")}</h2><p>{t("recentHelp")}</p></div><div className="notifications-card-actions"><span>{items.length}</span><MarkAllNotificationsRead label={t("markAllRead")} disabled={unread===0}/></div></header>{items.length?<div className="notifications-list">{items.map(item=><NotificationItem key={item.id} item={item} unreadLabel={t("unread")}/>)}</div>:<div className="notification-empty page-empty"><span><PortalIcon name="bell" size={25}/></span><strong>{t("emptyTitle")}</strong><p>{t("emptyText")}</p></div>}</section></div>;
}
