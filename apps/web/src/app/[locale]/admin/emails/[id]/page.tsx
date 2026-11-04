import { getLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { Locale } from "@aia/i18n";
import { DomainError, monitoredEmailDetail } from "@aia/domain";
import { requirePortal } from "@/server/session.ts";
import { database } from "@/server/runtime.ts";
import { EmailDetailView } from "@/components/email-monitoring.tsx";
import { emailCopy } from "@/lib/email-monitoring-copy.ts";
export default async function EmailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const locale = await getLocale() as Locale, access = await requirePortal(locale, "ADMIN");
  const { id } = await params, { cursor } = await searchParams;
  if (!z.uuid().safeParse(id).success || (cursor && !z.uuid().safeParse(cursor).success)) notFound();
  try { return <EmailDetailView locale={locale} data={await monitoredEmailDetail(database(), access.context, id, cursor)}/>; }
  catch (error) {
    if (error instanceof DomainError && error.code === "NOT_FOUND") notFound();
    const t = emailCopy[locale];
    return <div className="emails-page"><h1>{t.message}</h1><p role="alert">{t.unavailable}</p><Link className="button secondary" href={`/${locale}/admin/emails/${id}`}>{t.tryAgain}</Link></div>;
  }
}
