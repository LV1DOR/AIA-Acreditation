import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAdminOperations, loadDuplicateReview } from "../../../../server/portal-data.ts";
import { StatusBadge } from "../../../../components/status-badge.tsx";
import { PortalIcon } from "../../../../components/portal-icon.tsx";
import { overrideDuplicateAction } from "./actions.ts";
import { operationsCopy } from "../operations-copy.ts";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ eventId?: string; result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("portal");
  const w = await getTranslations("worker");
  const query = await searchParams;
  const [data, allDuplicates] = await Promise.all([loadAdminOperations(locale, query.eventId), loadDuplicateReview(locale)]);
  const event = data.event;
  if (!event) return <div className="ops-empty"><h1>{t("noEvents")}</h1></div>;
  const pending = data.registrations.filter(row => row.status === "AIA_REVIEW" && row.submissions[0]);
  const requests = data.requests.filter(row => row.status === "PENDING");
  const duplicates = allDuplicates.filter(row => row.eventId === event.id);
  const context = `?eventId=${encodeURIComponent(event.id)}`;
  return <div className="ops-workspace"><header className="ops-page-heading"><div><h1>{t("actionRequired")}</h1><p>{event.name} · {locale === "pt" ? "Submissões, pedidos e verificações de identidade pendentes." : "Pending submissions, requests and identity checks."}</p></div><strong className="ops-total">{pending.length + requests.length + duplicates.length}</strong></header>
    {query.result && <p className={`flash ${query.result === "saved" ? "success" : "error"}`}>{query.result === "saved" ? (locale === "pt" ? "Decisão guardada." : "Decision saved.") : (locale === "pt" ? "Não foi possível guardar. Atualize e tente novamente." : "Could not save. Refresh and try again.")}</p>}
    <section className="ops-panel"><div className="ops-panel-heading"><h2>{locale === "pt" ? "Pedidos que precisam de decisão" : "Requests needing a decision"} ({requests.length})</h2><Link href={`/${locale}/admin/requests${context}&status=PENDING`}>{locale === "pt" ? "Abrir pedidos" : "Open requests"}<PortalIcon name="arrow" size={16}/></Link></div>{requests.length ? <ul className="ops-queue-list">{requests.slice(0, 5).map(row => <li key={row.id}><strong>{row.registration.company.name}</strong><span>{operationsCopy[locale].requestType[row.type]}</span><Link href={`/${locale}/admin/requests${context}&q=${encodeURIComponent(row.registration.company.name)}`}>{locale === "pt" ? "Rever" : "Review"}</Link></li>)}</ul> : <p className="ops-empty-inline">{locale === "pt" ? "Sem pedidos pendentes." : "No pending requests."}</p>}</section>
    <section className="ops-panel"><div className="ops-panel-heading"><h2>{t("reviewQueue")} ({pending.length})</h2><Link href={`/${locale}/admin/submissions${context}&status=AIA_REVIEW`}>{locale === "pt" ? "Todas as submissões" : "All submissions"}<PortalIcon name="arrow" size={16}/></Link></div>{pending.length ? <div className="ops-table-scroll"><table><thead><tr><th>{t("company")}</th><th>{t("status")}</th><th/></tr></thead><tbody>{pending.map(row => <tr key={row.id}><td>{row.company.name}</td><td><StatusBadge value={row.status}/></td><td><Link className="ops-row-link" href={`/${locale}/admin/queue/${row.submissions[0]!.id}${context}`}>{locale === "pt" ? "Rever" : "Review"}<PortalIcon name="arrow" size={15}/></Link></td></tr>)}</tbody></table></div> : <p className="ops-empty-inline">{t("queueEmpty")}</p>}</section>
    <section className="ops-panel"><div className="ops-panel-heading"><h2>{w("reviewDuplicates")} ({duplicates.length})</h2></div>{duplicates.length ? <div className="record-list">{duplicates.map(item => <article className="participant-row" key={item.id}><div><strong>{item.fullName}</strong><p className="small muted">{item.companyName} · •••{item.documentNumberLast3}</p>{item.conflicts.map(conflict => <p className="small warning-text" key={conflict.id}>{w("duplicateConflict")}: {conflict.fullName} · {conflict.registration.company.name} · •••{conflict.documentNumberLast3}</p>)}</div><form action={overrideDuplicateAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="eventId" value={event.id}/><input type="hidden" name="participantId" value={item.id}/><button className="button secondary">{w("overrideDuplicate")}</button></form></article>)}</div> : <p className="ops-empty-inline">{w("noDuplicates")}</p>}</section>
  </div>;
}
