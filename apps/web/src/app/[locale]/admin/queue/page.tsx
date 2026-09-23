import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAdmin, loadDuplicateReview } from "../../../../server/portal-data.ts";
import { StatusBadge } from "../../../../components/status-badge.tsx";
import { overrideDuplicateAction } from "./actions.ts";

export default async function QueuePage() {
  const locale = await getLocale() as Locale, t = await getTranslations("portal"), w = await getTranslations("worker");
  const [data, duplicates] = await Promise.all([loadAdmin(locale), loadDuplicateReview(locale)]);
  return <>
    <div className="page-title"><div><p className="eyebrow">{t("actionRequired")}</p><h1>{t("reviewQueue")}</h1><p>{t("reviewHelp")}</p></div><span className="queue-count">{data.reviewCount + duplicates.length}</span></div>
    <section className="card">{data.pending.length ? <div className="table-scroll"><table><thead><tr><th>{t("company")}</th><th>{t("event")}</th><th>{t("status")}</th></tr></thead><tbody>{data.pending.map(item => <tr key={item.id}><td>{item.company.name}</td><td>{item.event.name}</td><td><StatusBadge value={item.status}/></td></tr>)}</tbody></table></div> : <div className="empty-state"><span aria-hidden="true">✓</span><h2>{t("queueEmpty")}</h2></div>}</section>
    <section className="card"><div className="section-heading"><h2>{w("reviewDuplicates")}</h2><span className="muted">{duplicates.length}</span></div>{duplicates.length ? <div className="record-list">{duplicates.map(item => <article className="participant-row" key={item.id}><div><strong>{item.fullName}</strong><p className="small muted">{item.companyName} · {item.eventName} · •••{item.documentNumberLast3}</p>{item.conflicts.map(conflict => <p className="small warning-text" key={conflict.id}>{w("duplicateConflict")}: {conflict.fullName} · {conflict.registration.company.name} · •••{conflict.documentNumberLast3}</p>)}</div><form action={overrideDuplicateAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="participantId" value={item.id}/><button className="button secondary">{w("overrideDuplicate")}</button></form></article>)}</div> : <p className="muted">{w("noDuplicates")}</p>}</section>
  </>;
}
