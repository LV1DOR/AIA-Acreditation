import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { emailMonitorQuery, listMonitoredEmails } from "@aia/domain";
import { requirePortal } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
import { EmailsView } from "@/components/email-monitoring.tsx";
import { emailCopy } from "@/lib/email-monitoring-copy.ts";
export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale() as Locale, access = await requirePortal(locale, "ADMIN");
  const raw = await searchParams, t = emailCopy[locale];
  const parsed = emailMonitorQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "")));
  if (!parsed.success) return <div className="emails-page"><h1>{t.title}</h1><p role="alert">{t.invalid}</p><Link className="button secondary" href={`/${locale}/admin/emails`}>{t.clear}</Link></div>;
  let data;
  try { data = await listMonitoredEmails(database(), access.context, parsed.data); }
  catch { return <div className="emails-page"><h1>{t.title}</h1><p role="alert">{t.unavailable}</p><Link className="button secondary" href={`/${locale}/admin/emails`}>{t.tryAgain}</Link></div>; }
  return <EmailsView locale={locale} data={data} query={parsed.data}/>;
}
