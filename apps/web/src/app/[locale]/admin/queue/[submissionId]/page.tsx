import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { StatusBadge } from "../../../../../components/status-badge.tsx";
import { loadAdminSubmission } from "../../../../../server/portal-data.ts";
import { AdminPhotoAdjustmentModal } from "../../../../../components/admin-photo-adjustment-modal.tsx";
import { AdminReviewDecision } from "../../../../../components/admin-review-decision.tsx";
import { PortalIcon } from "../../../../../components/portal-icon.tsx";

type Snapshot = { company: { name: string }; event: { name: string }; zones: { id: string; name: string }[]; vehiclePass: { required: boolean; requestedQuantity: number; justification: string | null }; participants: { id: string; fullName: string | null; documentNumberLast3: string | null; photoObjectKey: string | null; jobRole: { name: string } | null; workDays: string[] }[] };

export default async function SubmissionReviewPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("submission");
  const { submissionId } = await params;
  const submission = await loadAdminSubmission(locale, submissionId);
  const snapshot = submission.snapshot as unknown as Snapshot;
  const result = (await searchParams).result;
  const reviewable = submission.registration.status === "AIA_REVIEW" && submission.registration.submissions[0]?.id === submission.id;
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Lisbon" }).format(submission.submittedAt);
  const labels = locale === "pt" ? { reviews:"Revisões", submitted:"Submetido em", summary:"Resumo das informações enviadas pela empresa.", people:"Lista de pessoas", photo:"Fotografia", name:"Nome", role:"Função", document:"N.º cartão", days:"Dias de trabalho", full:"Integridade da versão", noPhoto:"Sem fotografia" } : { reviews:"Reviews", submitted:"Submitted on", summary:"Summary of the information sent by the company.", people:"People list", photo:"Photo", name:"Name", role:"Role", document:"Document no.", days:"Work days", full:"Version integrity", noPhoto:"No photo" };
  return <>
    <nav className="admin-review-breadcrumb" aria-label="Breadcrumb"><Link href={`/${locale}/admin`}>AIA</Link><PortalIcon name="arrow" size={14}/><Link href={`/${locale}/admin/queue`}>{labels.reviews}</Link><PortalIcon name="arrow" size={14}/><span>{t("reviewTitle")}</span></nav>
    <div className="admin-review-heading"><div><h1>{t("reviewTitle")}</h1><p>{snapshot.company.name} · {snapshot.event.name} · {t("version", { version: submission.version })}</p></div><div><StatusBadge value={submission.registration.status}/><small>{labels.submitted} {date}</small></div></div>
    {result && <p className={`flash ${["saved", "photo_saved"].includes(result) ? "success" : "error"}`}>{result === "saved" ? t("decisionSaved") : result === "photo_saved" ? (locale === "pt" ? "Enquadramento guardado." : "Photo framing saved.") : result === "stale_write" ? t("staleWrite") : t("error")}</p>}
    <div className="admin-review-grid">
      <section className="admin-submission-card"><header><span><PortalIcon name="document"/></span><div><h2>{t("snapshotContents")}</h2><p>{labels.summary}</p></div></header><dl className="review-facts"><div><span className="fact-icon"><PortalIcon name="pin"/></span><span><dt>{t("zones")}</dt><dd>{snapshot.zones.map(zone => zone.name).join(", ") || t("none")}</dd></span></div><div><span className="fact-icon"><PortalIcon name="car"/></span><span><dt>{t("vehicles")}</dt><dd>{snapshot.vehiclePass.required ? snapshot.vehiclePass.requestedQuantity : 0}</dd></span></div><div><span className="fact-icon"><PortalIcon name="people"/></span><span><dt>{locale === "pt" ? "Total de pessoas" : "Total people"}</dt><dd>{snapshot.participants.length}</dd></span></div></dl>
        <div className="admin-people-heading"><h3><PortalIcon name="people" size={19}/>{labels.people} ({snapshot.participants.length})</h3><details><summary>{labels.full}</summary><code>SHA-256 {submission.contentHash}</code></details></div>
        <div className="admin-people-table"><div className="admin-people-columns"><span>{labels.photo}</span><span>{labels.name}</span><span>{labels.role}</span><span>{labels.document}</span><span>{labels.days}</span></div>{snapshot.participants.map(person => <article key={person.id}><div>{reviewable && person.photoObjectKey ? <AdminPhotoAdjustmentModal locale={locale} submissionId={submission.id} participantId={person.id} name={person.fullName ?? "—"}/> : <span className="admin-no-photo">{labels.noPhoto}</span>}</div><strong>{person.fullName ?? "—"}</strong><span>{person.jobRole?.name ?? "—"}</span><span>•••{person.documentNumberLast3}</span><span>{person.workDays.length} {t("workDays")}</span></article>)}</div>
      </section>
      {reviewable ? <AdminReviewDecision locale={locale} submissionId={submission.id} version={submission.registration.version}/> : <aside className="admin-decision-card decided"><header><span><PortalIcon name="check"/></span><div><h2>{t("decision")}</h2><p>{t("alreadyDecided")}</p></div></header></aside>}
    </div>
    <Link className="button secondary admin-review-back" href={`/${locale}/admin/queue`}><PortalIcon name="back" size={18}/>{t("backToQueue")}</Link>
  </>;
}
