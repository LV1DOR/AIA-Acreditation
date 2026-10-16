import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { StatusBadge } from "../../../../../components/status-badge.tsx";
import { loadAdminSubmission } from "../../../../../server/portal-data.ts";
import { AdminParticipantReviewModal, type AdminReviewParticipant } from "../../../../../components/admin-participant-review-modal.tsx";
import { AdminReviewDecision } from "../../../../../components/admin-review-decision.tsx";
import { PortalIcon } from "../../../../../components/portal-icon.tsx";

type Snapshot = { company: { name: string; internalOrganisation?:string|null }; event: { name: string }; zones: { id: string; name: string }[]; vehiclePass: { required: boolean; requestedQuantity: number; justification: string | null }; participants: AdminReviewParticipant[] };

export default async function SubmissionReviewPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("submission");
  const { submissionId } = await params;
  const submission = await loadAdminSubmission(locale, submissionId);
  if((submission.snapshot as {erased?:boolean}).erased===true)return <><header className="ops-page-heading"><div><h1>{locale==="pt"?"Histórico após eliminação":"History after erasure"}</h1><p>{submission.registration.company.name} · {submission.registration.event.name} · v{submission.version}</p></div></header><p role="status">{locale==="pt"?"Os dados pessoais e fotografias desta versão foram eliminados ao abrigo da política autorizada. Mantém-se apenas a evidência mínima de decisões até ao seu prazo aprovado.":"Personal data and photographs in this version were erased under the authorised policy. Only minimal decision evidence remains until its approved deadline."}</p><dl><dt>{locale==="pt"?"Data da submissão":"Submission date"}</dt><dd>{submission.submittedAt.toLocaleString(locale==="pt"?"pt-PT":"en-GB",{timeZone:"Europe/Lisbon"})}</dd></dl><Link className="button secondary" href={`/${locale}/admin/operations?eventId=${submission.registration.eventId}`}>{locale==="pt"?"Ver operação de privacidade":"View privacy operation"}</Link></>;
  const snapshot = submission.snapshot as unknown as Snapshot;
  const result = (await searchParams).result;
  const reviewable = submission.registration.status === "AIA_REVIEW" && submission.registration.submissions[0]?.id === submission.id;
  const approvedPeople=submission.participantReviews.filter(review=>review.outcome === "APPROVED").length;
  const returnedPeople=submission.participantReviews.filter(review=>review.outcome === "RETURNED_FOR_CORRECTION").length;
  const pendingPeople=Math.max(0,snapshot.participants.length-submission.participantReviews.length);
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(submission.submittedAt);
  const labels = locale === "pt" ? { reviews:"Submissões", submitted:"Submetido em", summary:"Resumo das informações enviadas pela empresa.", people:"Lista de pessoas" } : { reviews:"Submissions", submitted:"Submitted on", summary:"Summary of the information sent by the company.", people:"People list" };
  const submissionsHref = `/${locale}/admin/submissions?eventId=${submission.registration.eventId}`;
  return <>
    <nav className="admin-review-breadcrumb" aria-label="Breadcrumb"><Link href={`/${locale}/admin?eventId=${submission.registration.eventId}`}>AIA</Link><PortalIcon name="arrow" size={14}/><Link href={submissionsHref}>{labels.reviews}</Link><PortalIcon name="arrow" size={14}/><span>{t("reviewTitle")}</span></nav>
    <div className="admin-review-heading"><div><h1>{t("reviewTitle")}</h1><p>{snapshot.company.name} · {snapshot.event.name} · {t("version", { version: submission.version })}</p></div><div><StatusBadge value={submission.registration.status}/><small>{labels.submitted} {date}</small></div></div>
    {result && <p className={`flash ${["saved", "photo_saved", "person_saved"].includes(result) ? "success" : "error"}`}>{result === "saved" ? t("decisionSaved") : result === "person_saved" ? (locale === "pt" ? "Decisão da pessoa guardada." : "Person decision saved.") : result === "photo_saved" ? (locale === "pt" ? "Enquadramento guardado." : "Photo framing saved.") : result === "stale_write" ? t("staleWrite") : t("error")}</p>}
    <div className="admin-review-grid">
      <section className="admin-submission-card"><header><span><PortalIcon name="document"/></span><div><h2>{t("snapshotContents")}</h2><p>{labels.summary}</p></div></header><dl className="review-facts"><div><span className="fact-icon"><PortalIcon name="pin"/></span><span><dt>{t("zones")}</dt><dd>{snapshot.company.internalOrganisation?(locale==="pt"?"Zonas individuais — ver cada pessoa":"Individual zones — review each worker"):snapshot.zones.map(zone => zone.name).join(", ") || t("none")}</dd></span></div><div><span className="fact-icon"><PortalIcon name="car"/></span><span><dt>{t("vehicles")}</dt><dd>{snapshot.vehiclePass.required ? snapshot.vehiclePass.requestedQuantity : 0}</dd></span></div><div><span className="fact-icon"><PortalIcon name="people"/></span><span><dt>{locale === "pt" ? "Total de pessoas" : "Total people"}</dt><dd>{snapshot.participants.length}</dd></span></div></dl>
        <div className="admin-people-heading"><h3><PortalIcon name="people" size={19}/>{labels.people} ({snapshot.participants.length})</h3></div>
        <div className="admin-people-table admin-people-buttons">{snapshot.participants.map(person => <AdminParticipantReviewModal key={person.id} locale={locale} submissionId={submission.id} person={person} reviewable={reviewable} decision={submission.participantReviews.find(review=>review.participantId === person.id) ?? null}/>)}</div>
      </section>
      {reviewable ? <AdminReviewDecision locale={locale} submissionId={submission.id} version={submission.registration.version} approvedPeople={approvedPeople} returnedPeople={returnedPeople} pendingPeople={pendingPeople}/> : <aside className="admin-decision-card decided"><header><span><PortalIcon name="check"/></span><div><h2>{t("decision")}</h2><p>{t("alreadyDecided")}</p></div></header></aside>}
    </div>
    <Link className="button secondary admin-review-back" href={submissionsHref}><PortalIcon name="back" size={18}/>{labels.reviews}</Link>
  </>;
}
