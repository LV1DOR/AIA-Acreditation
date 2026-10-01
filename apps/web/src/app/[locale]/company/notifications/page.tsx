import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { NotificationsPage } from "../../../../components/notifications-page.tsx";
export default async function CompanyNotificationsPage(){return <NotificationsPage locale={await getLocale() as Locale} role="COMPANY_LEADER"/>;}
