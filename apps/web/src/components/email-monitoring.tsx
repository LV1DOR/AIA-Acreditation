import Link from "next/link";
import type { Locale } from "@aia/i18n";
import type { listMonitoredEmails, monitoredEmailDetail, EmailMonitorQuery } from "@aia/domain";
import { emailCopy, emailStatusLabels, emailCategoryLabel, explainEmailCode, multipleProviderExplanation } from "../lib/email-monitoring-copy.ts";
import { emailInvestigationCopy, emailEventExplanation } from "../lib/email-investigation-copy.ts";
import { EmailMonitorRefresh } from "./email-monitor-refresh.tsx";
import { EmailMonitorFilters } from "./email-monitor-filters.tsx";
import { EmailEventsTimeline } from "./examples/c-timeline-3.tsx";
import { EmailTableViewport } from "./email-table-viewport.tsx";

type List = Awaited<ReturnType<typeof listMonitoredEmails>>;
type Detail = Awaited<ReturnType<typeof monitoredEmailDetail>>;
function DateLabel({ value, locale }: { value: Date | null; locale: Locale }) {
  return value ? <time dateTime={value.toISOString()} title={value.toISOString()}>{new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium", timeStyle: "short" }).format(value)}</time> : <span className="muted">{emailCopy[locale].unknown}</span>;
}
function EmailStatus({ value, locale }: { value: string; locale: Locale }) {
  const tone = value === "DELIVERED" ? "success" : ["FAILED", "BOUNCED", "SUPPRESSED", "COMPLAINED"].includes(value) ? "danger" : ["DELIVERY_DELAYED", "RETRYING", "UNKNOWN"].includes(value) ? "warning" : "neutral";
  return <span className={`email-status email-status-${tone}`}>{emailStatusLabels[locale][value] ?? emailCopy[locale].unknown}</span>;
}
export function EmailsView({ locale, data, query }: { locale: Locale; data: List; query: EmailMonitorQuery }) {
  const t = emailCopy[locale], c = emailInvestigationCopy[locale], root = `/${locale}/admin/emails`;
  const pageLink = (cursor: string, direction: "older" | "newer") => `${root}?${new URLSearchParams(Object.entries({ ...query, cursor, direction }).filter((v): v is [string, string] => typeof v[1] === "string" && Boolean(v[1])))}`;
  return <div className="emails-page emails-list-page">
    <header className="emails-heading"><h1>{t.title}</h1><EmailMonitorRefresh label={c.refresh}/></header>
    <EmailMonitorFilters locale={locale} query={query.q ?? ""} status={query.status ?? ""} eventId={query.eventId}/>
    <section className={`emails-results${data.messages.length < 15 ? " emails-results-partial" : ""}`} aria-label={t.title}>
      {data.messages.length ? <EmailTableViewport label={t.title}><table><caption className="sr-only">{c.intro}</caption><colgroup><col className="emails-col-to"/><col className="emails-col-status"/><col className="emails-col-subject"/><col className="emails-col-date"/><col className="emails-col-details"/></colgroup><thead><tr><th scope="col">{c.to}</th><th scope="col">{t.status}</th><th scope="col">{c.subject}</th><th scope="col">{c.date}</th><th scope="col"><span className="sr-only">{c.details}</span></th></tr></thead><tbody>{data.messages.map(row => <tr key={row.id}>
        <td className="emails-recipient"><Link className="emails-text-link" title={row.recipients.join(", ")} href={`${root}/${row.id}`}>{row.recipients.join(", ") || t.noRecipient}</Link>{row.provider !== "resend" && <small>{row.provider === "smtp" ? "SMTP" : t.pendingProvider} · {t.queueOnly}</small>}</td>
        <td><EmailStatus locale={locale} value={row.displayStatus}/></td>
        <td className="emails-subject"><Link title={row.subject ?? c.noSubject} href={`${root}/${row.id}`}>{row.subject ?? c.noSubject}</Link></td>
        <td className="emails-dates"><DateLabel locale={locale} value={row.sentAt ?? row.createdAt}/></td>
        <td><Link className="emails-text-link" href={`${root}/${row.id}`}>{c.details}</Link></td>
      </tr>)}</tbody></table></EmailTableViewport> : <div className="emails-empty"><h2>{t.empty}</h2><p>{t.emptyHelp}</p></div>}
      <nav className="emails-pagination" aria-label={t.pagination}>
        {data.previousCursor ? <a className="button secondary" href={pageLink(data.previousCursor, "newer")}>{c.newer}</a> : <span className="button secondary" aria-disabled="true">{c.newer}</span>}
        {data.nextCursor ? <a className="button secondary" href={pageLink(data.nextCursor, "older")}>{t.older}</a> : <span className="button secondary" aria-disabled="true">{t.older}</span>}
      </nav>
    </section>
    <p className="emails-delivery-note">{t.deliveryMeaning}</p>
  </div>;
}
export function EmailDetailView({ locale, data }: { locale: Locale; data: Detail }) {
  const t = emailCopy[locale], c = emailInvestigationCopy[locale], root = `/${locale}/admin/emails`, row = data.message;
  const outcome = data.events.find(event => event.type.replace("email.", "").toUpperCase() === row.displayStatus);
  const problem = ["BOUNCED", "FAILED", "SUPPRESSED", "COMPLAINED", "DELIVERY_DELAYED"].includes(row.displayStatus) ? emailEventExplanation(locale, outcome?.reasonCode ?? row.lastFailureCode, row.displayStatus) : null;
  return <div className="emails-page"><Link className="emails-text-link" href={root}>{t.back}</Link>
    <header className="emails-heading"><div><h1>{row.subject ?? c.noSubject}</h1><p className="emails-address">{row.recipients.join(", ") || t.noRecipient}</p></div><EmailStatus locale={locale} value={row.displayStatus}/><EmailMonitorRefresh label={c.refresh}/></header>
    <dl className="emails-message-facts"><div><dt>{c.from}</dt><dd>{row.sender ?? t.unknown}</dd></div><div><dt>{c.to}</dt><dd>{row.recipients.join(", ") || t.noRecipient}</dd></div><div><dt>{c.date}</dt><dd><DateLabel locale={locale} value={row.sentAt ?? row.createdAt}/></dd></div></dl>
    {problem && <div className={`emails-outcome ${row.displayStatus === "DELIVERY_DELAYED" ? "emails-outcome-warning" : "emails-outcome-danger"}`}><h2>{problem.title}</h2><p>{problem.description}</p>{problem.action && <p><strong>{problem.action}</strong></p>}</div>}
    <section className="emails-timeline"><h2>{c.events}</h2><p className="emails-timezone">{c.timezone}</p>{data.events.length ? <EmailEventsTimeline locale={locale} events={data.events}/> : <p>{t.noEvents}</p>}{data.nextCursor && <Link className="button secondary" href={`${root}/${row.id}?cursor=${data.nextCursor}`}>{t.eventsMore}</Link>}</section>
    <p className="emails-delivery-note">{t.deliveryMeaning}</p>
    <details className="emails-health"><summary>{c.advanced}</summary><p>{t.coverage}</p><dl className="emails-facts"><div><dt>{t.context}</dt><dd>{row.companyName ?? t.unlinked}<br/>{row.eventName ?? t.unknown}</dd></div><div><dt>{t.category}</dt><dd>{emailCategoryLabel(locale, row.category)}</dd></div><div><dt>{t.provider}</dt><dd>{row.provider === "resend" ? "Resend" : row.provider === "smtp" ? "SMTP" : t.pendingProvider}</dd></div><div><dt>{t.delivered}</dt><dd><DateLabel locale={locale} value={row.deliveredAt}/></dd></div><div><dt>{t.providerId}</dt><dd>{row.providerIdentities.map(identity => identity.resendEmailId).join(", ") || row.resendEmailId || t.unknown}</dd></div></dl>
      {row.providerIdentities.length > 1 && <p>{multipleProviderExplanation[locale]}</p>}
      {row.reconciledAt && <p>{t.snapshot}: {emailStatusLabels[locale][row.reconciledStatus ?? ""] ?? t.unknown} · <DateLabel locale={locale} value={row.reconciledAt}/><br/>{t.snapshotHelp}</p>}
      {row.lastFailureCode && <p>{explainEmailCode(locale, row.lastFailureCode)}</p>}
    </details>
  </div>;
}
