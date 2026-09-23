import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAdmin } from "../../../../server/portal-data.ts";
import { StatusBadge } from "../../../../components/status-badge.tsx";
export default async function QueuePage() {
  const locale = await getLocale() as Locale, t = await getTranslations("portal"), data = await loadAdmin(locale);
  return <><div className="page-title"><div><p className="eyebrow">{t("actionRequired")}</p><h1>{t("reviewQueue")}</h1><p>{t("reviewHelp")}</p></div><span className="queue-count">{data.reviewCount}</span></div>
    <section className="card">{data.pending.length ? <div className="table-scroll"><table><thead><tr><th>{t("company")}</th><th>{t("event")}</th><th>{t("status")}</th></tr></thead><tbody>{data.pending.map(item => <tr key={item.id}><td>{item.company.name}</td><td>{item.event.name}</td><td><StatusBadge value={item.status}/></td></tr>)}</tbody></table></div> : <div className="empty-state"><span aria-hidden="true">✓</span><h2>{t("queueEmpty")}</h2></div>}</section></>;
}

