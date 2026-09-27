import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadLeader } from "../../../server/portal-data.ts";
import { StatusBadge } from "../../../components/status-badge.tsx";
import { LeaderEventHero } from "../../../components/leader-event-hero.tsx";
import { ParticipantProfileModal, type ParticipantProfile } from "../../../components/participant-profile-modal.tsx";
import { PortalIcon } from "../../../components/portal-icon.tsx";
import { ParticipantAvatar } from "../../../components/participant-avatar.tsx";

export default async function CompanyPage() {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("portal");
  const worker = await getTranslations("worker");
  const status = await getTranslations("status");
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
  const profileDate = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const countries = new Intl.DisplayNames([locale === "pt" ? "pt-PT" : "en-GB"], { type: "region" });
  const editable = row.event.status === "ONBOARDING_OPEN" && ["DRAFT", "RETURNED_FOR_CORRECTION"].includes(row.status);
  const latestReview = row.submissions[0]?.reviews[0];
  const reviewReasons:Record<string,string> = { PHOTO:locale === "pt" ? "Fotografia" : "Photo", IDENTITY:locale === "pt" ? "Identificação" : "Identity", DOCUMENT:locale === "pt" ? "Documento" : "Document", DUPLICATE:locale === "pt" ? "Possível duplicado" : "Possible duplicate", HEADCOUNT:locale === "pt" ? "Limite de pessoas" : "Personnel limit", ZONES:locale === "pt" ? "Zonas" : "Zones", VEHICLE_PASS:locale === "pt" ? "Passe de veículo" : "Vehicle pass", WORK_DAYS:locale === "pt" ? "Dias de trabalho" : "Work days", OTHER:locale === "pt" ? "Outro" : "Other" };
  const returnedCorrections=latestReview?.outcome === "RETURNED_FOR_CORRECTION" ? row.submissions[0]?.participantReviews ?? [] : [];
  const returnedIds=new Set(returnedCorrections.map(correction=>correction.participantId));
  const ordinaryActions=[...issues,...review].filter(person=>!returnedIds.has(person.id));
  const generalCorrection=latestReview?.outcome === "RETURNED_FOR_CORRECTION" && returnedCorrections.length === 0 ? latestReview : null;
  const generalCorrectionHref=["ZONES","VEHICLE_PASS","HEADCOUNT"].includes(generalCorrection?.reasonCategory ?? "") ? `/${locale}/company/${row.id}` : `/${locale}/company/${row.id}/submission`;
  const copy = locale === "pt" ? {
    company: "EMPRESA", companyHelp: "Gestão de equipas para eventos", motto: "Acreditar pessoas. Fazer acontecer.", submissionStatus: "Estado da submissão",
    preparing: "Em preparação", deadline: "Prazo da submissão final", daysRemaining: `${daysRemaining} dias restantes`, deadlineClosed: "Prazo terminado",
    zones: "Zonas solicitadas", vehicles: "Pedidos de veículos", approved: "aprovados", workers: "Trabalhadores", added: "Adicionados",
    submitted: "Submetidos", review: "Em revisão", issues: "Com problemas", add: "Adicionar trabalhador", configure: "Configurar participação",
    finalReview: "Rever submissão final",
  } : {
    company: "COMPANY", companyHelp: "Event workforce management", motto: "Accrediting people. Making it happen.", submissionStatus: "Submission status",
    preparing: "In preparation", deadline: "Final submission deadline", daysRemaining: `${daysRemaining} days remaining`, deadlineClosed: "Deadline closed",
    zones: "Requested zones", vehicles: "Vehicle pass requests", approved: "approved", workers: "Workers", added: "Added",
    submitted: "Submitted", review: "Pending review", issues: "Issues", add: "Add worker", configure: "Configure registration",
    finalReview: "Review final submission",
  };
  const profile = (person: typeof people[number]): ParticipantProfile => ({
    id: person.id, name: person.fullName ?? worker("addParticipant"), status: person.status, statusLabel: status(person.status),
    documentNumber: person.documentNumber, dateOfBirth: person.dateOfBirth ? profileDate.format(person.dateOfBirth) : null,
    documentType: person.documentType ? worker(person.documentType) : null, documentExpiry: person.documentExpiryDate ? profileDate.format(person.documentExpiryDate) : null,
    mobile: person.mobileE164, nationalityCode: person.nationalityCode, nationality: person.nationalityCode ? countries.of(person.nationalityCode) ?? person.nationalityCode : null,
    jobRole: person.jobRole?.name ?? null, workDays: person.workDays.map(day => profileDate.format(day.workDate)), privacyAcknowledged: Boolean(person.privacyAcknowledgedAt),
    photoUrl: person.photoObjectKey ? `/api/participants/${person.id}/photo` : undefined,
  });

  return <>
    <LeaderEventHero name={row.event.name} startDate={row.event.startDate} endDate={row.event.endDate} locale={locale}/>
    <header className="leader-overview-heading"><h2>{row.company.name}</h2><h1>{locale === "pt" ? "Visão geral" : "Overview"}</h1><span>{locale === "pt" ? "Acompanhe o estado da submissão e garanta que todas as pessoas estão prontas para o evento." : "Track the submission and make sure every person is ready for the event."}</span></header>

    <section className="leader-summary-grid">
      <article className="summary-card"><h3>{copy.submissionStatus}</h3><div className="summary-highlight amber"><PortalIcon name="clock" size={28}/><span><strong>{row.status === "DRAFT" ? copy.preparing : status(row.status)}</strong></span></div></article>
      <article className="summary-card"><h3>{copy.deadline}</h3><div className="summary-stat"><PortalIcon name="calendar" size={32}/><span><strong>{date.format(row.event.onboardingClosesAt)}</strong><small>{daysRemaining ? copy.daysRemaining : copy.deadlineClosed}</small></span></div></article>
      <article className="summary-card"><h3>{copy.zones}</h3><div className="summary-stat"><PortalIcon name="pin" size={32}/><strong>{row.zones.length}</strong><small>{row.zones.map(item => item.eventZone.zone.name).join(" · ") || t("noZones")}</small></div></article>
      <article className="summary-card"><h3>{copy.vehicles}</h3><div className="summary-stat"><PortalIcon name="car" size={32}/><strong>{requestedVehicles}</strong><small>{row.vehiclePass?.approvedQuantity ?? 0} {copy.approved}</small></div></article>
    </section>

    <section className="leader-workers-strip"><div className="leader-workers-summary-heading"><div><span className="metric-icon neutral"><PortalIcon name="people"/></span><h2>{copy.workers}</h2></div><strong>{people.length}<small>{locale === "pt" ? "Total da empresa" : "Company total"}</small></strong></div><div className="worker-metrics">
      <div><span className="metric-icon neutral"><PortalIcon name="people"/></span><strong>{people.length}</strong><small>{copy.added}</small></div>
      <div><span className="metric-icon green"><PortalIcon name="check"/></span><strong>{ready}</strong><small>{copy.submitted}</small></div>
      <div><span className="metric-icon amber"><PortalIcon name="clock"/></span><strong>{review.length}</strong><small>{copy.review}</small></div>
      <div><span className="metric-icon red"><PortalIcon name="alert"/></span><strong>{issues.length}</strong><small>{copy.issues}</small></div>
    </div></section>

    <section className="leader-action-card"><div className="leader-action-heading"><span className="metric-icon red"><PortalIcon name="alert"/></span><h2>{locale === "pt" ? "Ações necessárias" : "Action required"}</h2></div>{returnedCorrections.map(correction=>{const person=people.find(item=>item.id===correction.participantId);if(!person)return null;const reason=correction.reasonCategory ? reviewReasons[correction.reasonCategory] ?? correction.reasonCategory:null;return <Link className="action-row correction-action-row" href={`/${locale}/company/${row.id}/participants/${person.id}`} key={`correction-${person.id}`}><ParticipantAvatar name={person.fullName ?? worker("addParticipant")} photoUrl={person.photoObjectKey ? `/api/participants/${person.id}/photo`:undefined}/><strong>{person.fullName ?? worker("addParticipant")}</strong><span><i className="red"><PortalIcon name="alert" size={18}/></i><span><b>{locale === "pt" ? "Devolvido para correção":"Returned for correction"}{reason ? ` · ${reason}`:""}</b>{correction.comment && <small>{correction.comment}</small>}</span></span><PortalIcon name="arrow"/></Link>;})}{generalCorrection && <Link className="action-row correction-action-row general-correction-row" href={generalCorrectionHref}><span className="metric-icon red"><PortalIcon name="alert"/></span><strong>{generalCorrection.reasonCategory ? reviewReasons[generalCorrection.reasonCategory] ?? generalCorrection.reasonCategory : (locale === "pt" ? "Submissão":"Submission")}</strong><span><span><b>{locale === "pt" ? "Devolvido para correção":"Returned for correction"}</b>{generalCorrection.comment && <small>{generalCorrection.comment}</small>}</span></span><PortalIcon name="arrow"/></Link>}{ordinaryActions.slice(0,Math.max(0,4-returnedCorrections.length-(generalCorrection ? 1:0))).map(person => <ParticipantProfileModal key={person.id} locale={locale} registrationId={row.id} participant={profile(person)} editable={editable} variant="action" issueLabel={person.status === "DUPLICATE_REVIEW_REQUIRED" ? (locale === "pt" ? "Possível duplicado" : "Possible duplicate") : (locale === "pt" ? "Rever dados" : "Review details")}/>)}{!returnedCorrections.length && !generalCorrection && !ordinaryActions.length && <p className="leader-empty-line"><PortalIcon name="check"/>{locale === "pt" ? "Sem ações pendentes" : "No action required"}</p>}</section>

    <div className="leader-primary-actions"><Link className="button primary" href={`/${locale}/company/${row.id}#workers`}><PortalIcon name="people"/>{copy.add}</Link><Link className="button secondary" href={`/${locale}/company/${row.id}`}><PortalIcon name="settings"/>{copy.configure}</Link><Link className="button review-action" href={`/${locale}/company/${row.id}/submission`}><PortalIcon name="document"/>{copy.finalReview}</Link></div>

    {rows.length > 1 && <section className="other-registrations"><h2>{t("myCompanies")}</h2><div className="registration-grid">{rows.slice(1).map(item => <article className="card registration-card" key={item.id}><div className="section-heading"><span className="eyebrow">{item.company.name}</span><StatusBadge value={item.status}/></div><h2>{item.event.name}</h2><Link className="button secondary" href={`/${locale}/company/${item.id}`}>{t("configure")}</Link></article>)}</div></section>}
  </>;
}
