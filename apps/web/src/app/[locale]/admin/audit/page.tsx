import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAudit } from "../../../../server/portal-data.ts";
export default async function AuditPage() {
  const locale = await getLocale() as Locale, t = await getTranslations("portal"), rows = await loadAudit(locale);
  return <><div className="page-title"><div><p className="eyebrow">{t("settings")}</p><h1>{t("audit")}</h1><p>{t("auditIntro")}</p></div></div><section className="card">
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>{t("when")}</th><th>{t("actor")}</th><th>{t("action")}</th><th>{t("record")}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone:"Europe/Lisbon", dateStyle:"short", timeStyle:"short" }).format(row.occurredAt)}</td><td>{row.actorType}</td><td><code>{row.action}</code></td><td><span>{row.entityType}</span><br/><code className="small">{row.entityId}</code></td></tr>)}</tbody></table></div> : <p>{t("emptyAudit")}</p>}</section></>;
}

