import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { NotificationsPage } from "../../../../components/notifications-page.tsx";
export default async function AdminNotificationsPage(){return <NotificationsPage locale={await getLocale() as Locale} role="ADMIN"/>;}
