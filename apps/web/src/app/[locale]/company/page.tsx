import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadLeader } from "../../../server/portal-data.ts";
import { StatusBadge } from "../../../components/status-badge.tsx";
import Link from "next/link";
export default async function CompanyPage() {
  const locale = await getLocale() as Locale, t = await getTranslations("portal"), rows = await loadLeader(locale);
  return <><div className="page-title"><div><p className="eyebrow">{t("leader")}</p><h1>{t("myCompanies")}</h1><p>{t("myCompaniesText")}</p></div></div>
    {rows.length ? <div className="registration-grid">{rows.map(row => <article className="card registration-card" key={row.id}><div className="section-heading"><span className="eyebrow">{row.company.name}</span><StatusBadge value={row.status}/></div><h2>{row.event.name}</h2><dl><div><dt>{t("limit")}</dt><dd>{row.personnelLimit}</dd></div><div><dt>{t("deadline")}</dt><dd>{new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone:"Europe/Lisbon", dateStyle:"medium", timeStyle:"short" }).format(row.event.onboardingClosesAt)}</dd></div><div><dt>{t("zones")}</dt><dd>{row.zones.map(item => item.eventZone.zone.name).join(", ") || t("noZones")}</dd></div></dl><Link className="button secondary" href={`/${locale}/company/${row.id}`}>{t("configure")}</Link></article>)}</div> : <section className="card empty-state"><span aria-hidden="true">▦</span><h2>{t("noRegistrations")}</h2><p>{t("noRegistrationsText")}</p></section>}</>;
}
