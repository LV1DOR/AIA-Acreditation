import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAdmin } from "../../../server/portal-data.ts";
import { StatusBadge } from "../../../components/status-badge.tsx";
export default async function AdminPage() {
  const locale = await getLocale() as Locale, t = await getTranslations("portal"), data = await loadAdmin(locale);
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(value);
  return <><div className="page-title"><div><p className="eyebrow">AIA / {t("overview")}</p><h1>{t("welcome")}</h1><p>{t("intro")}</p></div><Link className="button primary" href={"/" + locale + "/admin/queue"}>{t("actionRequired")} <span className="counter light">{data.reviewCount + data.requestCount}</span></Link></div>
    <section className="metrics">{([["events",data.events],["companies",data.companies],["registrations",data.registrations]] as const).map(([label,count]) => <article key={label} className="metric"><span>{t(label)}</span><strong>{count}</strong></article>)}</section>
    <section className="card"><div className="section-heading"><h2>{t("events")}</h2><span className="muted">{data.events}</span></div>
    {data.recentEvents.length ? <div className="table-scroll"><table><thead><tr><th>{t("event")}</th><th>{t("dates")}</th><th>{t("registrations")}</th><th>{t("status")}</th></tr></thead><tbody>{data.recentEvents.map(event => <tr key={event.id}><td><strong>{event.name}</strong></td><td>{date(event.startDate)} – {date(event.endDate)}</td><td>{event._count.registrations}</td><td><StatusBadge value={event.status}/></td></tr>)}</tbody></table></div> : <div className="empty-state"><span aria-hidden="true">▦</span><h3>{t("noEvents")}</h3><p>{t("noEventsText")}</p></div>}
    </section><p className="small muted">{t("readOnly")}</p></>;
}
