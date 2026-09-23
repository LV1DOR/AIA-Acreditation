import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadLeader } from "../../../server/portal-data.ts";
import { StatusBadge } from "../../../components/status-badge.tsx";
import { LeaderEventHero } from "../../../components/leader-event-hero.tsx";
import { PortalIcon } from "../../../components/portal-icon.tsx";

export default async function CompanyPage() {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("portal");
  const rows = await loadLeader(locale);
  if (!rows.length) return <section className="card empty-state"><PortalIcon name="people" size={34}/><h2>{t("noRegistrations")}</h2><p>{t("noRegistrationsText")}</p></section>;

  const row = rows[0]!;
  const people = row.participants.filter(person => !["REMOVED", "REPLACED"].includes(person.status));
  const ready = people.filter(person => person.status === "LEADER_APPROVED").length;
  const issues = people.filter(person => person.status === "DUPLICATE_REVIEW_REQUIRED");
  const review = people.filter(person => person.status === "AWAITING_LEADER_REVIEW");
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", day: "2-digit", month: "short", year: "numeric" });
  const daysRemaining = Math.max(0, Math.ceil((row.event.onboardingClosesAt.getTime() - Date.now()) / 86_400_000));
  const requestedVehicles = row.vehiclePass?.required ? row.vehiclePass.requestedQuantity : 0;

  return <>
    <LeaderEventHero name={row.event.name} startDate={row.event.startDate} endDate={row.event.endDate} locale={locale}/>
    <section className="leader-company-strip"><div><p>EMPRESA / COMPANY</p><h2>{row.company.name}</h2><span>Gestão de equipas para eventos / Event workforce management</span></div><div><strong>Acreditar pessoas. Fazer acontecer.</strong><span>Accrediting people. Making it happen.</span><i/></div></section>

    <section className="leader-summary-grid">
      <article className="summary-card"><h3>Estado da submissão</h3><p>Submission status</p><div className="summary-highlight amber"><PortalIcon name="clock" size={28}/><span><strong>{row.status === "DRAFT" ? "Em preparação" : t("status")}</strong><small>{row.status === "DRAFT" ? "In preparation" : ""}</small></span></div></article>
      <article className="summary-card"><h3>Prazo da submissão final</h3><p>Final submission deadline</p><div className="summary-stat"><PortalIcon name="calendar" size={32}/><span><strong>{date.format(row.event.onboardingClosesAt)}</strong><small>{daysRemaining ? `${daysRemaining} dias / days remaining` : "Prazo terminado / Deadline closed"}</small></span></div></article>
      <article className="summary-card"><h3>Zonas solicitadas</h3><p>Requested zones</p><div className="summary-stat"><PortalIcon name="pin" size={32}/><strong>{row.zones.length}</strong><small>{row.zones.map(item => item.eventZone.zone.name).join(" · ") || t("noZones")}</small></div></article>
      <article className="summary-card"><h3>Pedidos de veículos</h3><p>Vehicle pass requests</p><div className="summary-stat"><PortalIcon name="car" size={32}/><strong>{requestedVehicles}</strong><small>{row.vehiclePass?.approvedQuantity ?? 0} aprovados / approved</small></div></article>
    </section>

    <section className="leader-workers-strip"><h2>Trabalhadores <span>/ Workers</span></h2><div className="worker-metrics">
      <div><span className="metric-icon neutral"><PortalIcon name="people"/></span><strong>{people.length}</strong><small>Adicionados<br/><span>Added</span></small></div>
      <div><span className="metric-icon green"><PortalIcon name="check"/></span><strong>{ready}</strong><small>Submetidos<br/><span>Submitted</span></small></div>
      <div><span className="metric-icon amber"><PortalIcon name="clock"/></span><strong>{review.length}</strong><small>Em revisão<br/><span>Pending review</span></small></div>
      <div><span className="metric-icon red"><PortalIcon name="alert"/></span><strong>{issues.length}</strong><small>Com problemas<br/><span>Issues</span></small></div>
    </div></section>

    <section className="leader-action-card"><h2>Ações necessárias <span>/ Action required</span></h2>{[...issues, ...review].length ? [...issues, ...review].slice(0, 4).map(person => <Link key={person.id} href={`/${locale}/company/${row.id}/participants/${person.id}`} className="action-row"><span className="person-initials">{initials(person.fullName)}</span><strong>{person.fullName ?? "—"}</strong><span><i className={person.status === "DUPLICATE_REVIEW_REQUIRED" ? "red" : "amber"}><PortalIcon name="alert" size={18}/></i>{person.status === "DUPLICATE_REVIEW_REQUIRED" ? "Possível duplicado / Possible duplicate" : "Rever dados / Review details"}</span><PortalIcon name="arrow"/></Link>) : <p className="leader-empty-line"><PortalIcon name="check"/>Sem ações pendentes / No action required</p>}</section>

    <div className="leader-primary-actions"><Link className="button primary" href={`/${locale}/company/${row.id}#workers`}><PortalIcon name="people"/>Adicionar trabalhador <small>Add worker</small></Link><Link className="button secondary" href={`/${locale}/company/${row.id}`}><PortalIcon name="settings"/>Configurar participação <small>Configure registration</small></Link><span className="button future-action" aria-disabled="true"><PortalIcon name="document"/>Rever submissão final <small>Future phase</small></span></div>

    {rows.length > 1 && <section className="other-registrations"><h2>{t("myCompanies")}</h2><div className="registration-grid">{rows.slice(1).map(item => <article className="card registration-card" key={item.id}><div className="section-heading"><span className="eyebrow">{item.company.name}</span><StatusBadge value={item.status}/></div><h2>{item.event.name}</h2><Link className="button secondary" href={`/${locale}/company/${item.id}`}>{t("configure")}</Link></article>)}</div></section>}
  </>;
}

function initials(name: string | null) {
  if (!name) return "—";
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
