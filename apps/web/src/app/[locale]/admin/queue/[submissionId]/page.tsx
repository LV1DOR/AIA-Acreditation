import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { StatusBadge } from "../../../../../components/status-badge.tsx";
import { loadAdminSubmission } from "../../../../../server/portal-data.ts";
import { reviewSubmissionAction } from "./actions.ts";
import { AdminPhotoAdjustmentModal } from "../../../../../components/admin-photo-adjustment-modal.tsx";

type Snapshot = { company: { name: string }; event: { name: string }; zones: { id: string; name: string }[]; vehiclePass: { required: boolean; requestedQuantity: number; justification: string | null }; participants: { id: string; fullName: string | null; documentNumberLast3: string | null; photoObjectKey: string | null; jobRole: { name: string } | null; workDays: string[] }[] };

export default async function SubmissionReviewPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("submission");
  const { submissionId } = await params;
  const submission = await loadAdminSubmission(locale, submissionId);
  const snapshot = submission.snapshot as unknown as Snapshot;
  const result = (await searchParams).result;
  const reviewable = submission.registration.status === "AIA_REVIEW" && submission.registration.submissions[0]?.id === submission.id;
  return <>
    <div className="page-title"><div><p className="eyebrow">AIA / REVIEW</p><h1>{t("reviewTitle")}</h1><p>{snapshot.company.name} · {snapshot.event.name} · {t("version", { version: submission.version })}</p></div><StatusBadge value={submission.registration.status}/></div>
    {result && <p className={`flash ${["saved", "photo_saved"].includes(result) ? "success" : "error"}`}>{result === "saved" ? t("decisionSaved") : result === "photo_saved" ? (locale === "pt" ? "Enquadramento guardado." : "Photo framing saved.") : result === "stale_write" ? t("staleWrite") : t("error")}</p>}
    <div className="admin-review-grid">
      <section className="card"><h2>{t("snapshotContents")}</h2><dl className="review-facts"><div><dt>{t("zones")}</dt><dd>{snapshot.zones.map(zone => zone.name).join(", ") || t("none")}</dd></div><div><dt>{t("vehicles")}</dt><dd>{snapshot.vehiclePass.required ? snapshot.vehiclePass.requestedQuantity : 0}</dd></div><div><dt>{t("workers")}</dt><dd>{snapshot.participants.length}</dd></div><div><dt>SHA-256</dt><dd><code>{submission.contentHash}</code></dd></div></dl>
        <div className="snapshot-workers">{snapshot.participants.map(person => <article key={person.id}>{reviewable && person.photoObjectKey && <AdminPhotoAdjustmentModal locale={locale} submissionId={submission.id} participantId={person.id} name={person.fullName ?? "—"}/>}<strong>{person.fullName}</strong><span>{person.jobRole?.name ?? "—"} · •••{person.documentNumberLast3}</span><small>{person.workDays.length} {t("workDays")}</small></article>)}</div>
      </section>
      <aside className="card"><h2>{t("decision")}</h2>{reviewable ? <div className="review-form">
        <form action={reviewSubmissionAction}><ReviewFields locale={locale} submissionId={submission.id} version={submission.registration.version}/><button className="button primary" name="decision" value="APPROVE">{t("approve")}</button></form>
        <form action={reviewSubmissionAction} className="review-form"><ReviewFields locale={locale} submissionId={submission.id} version={submission.registration.version}/><label>{t("reason")}<select name="reason" defaultValue="OTHER" required><option value="ZONES">Zones</option><option value="VEHICLE_PASS">Vehicle pass</option><option value="PERSONNEL">Personnel</option><option value="PHOTO">Photo</option><option value="DOCUMENT">Document</option><option value="WORK_DAYS">Work days</option><option value="HEADCOUNT">Headcount</option><option value="DUPLICATE">Duplicate</option><option value="OTHER">Other</option></select></label><label>{t("comment")}<textarea name="comment" maxLength={4000} required/></label><div className="review-buttons"><button className="button secondary" name="decision" value="RETURN">{t("return")}</button><button className="button danger" name="decision" value="REJECT">{t("reject")}</button></div></form>
      </div> : <p>{t("alreadyDecided")}</p>}</aside>
    </div>
    <Link className="button secondary" href={`/${locale}/admin/queue`}>{t("backToQueue")}</Link>
  </>;
}

function ReviewFields({ locale, submissionId, version }: { locale: Locale; submissionId: string; version: number }) {
  return <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="submissionId" value={submissionId}/><input type="hidden" name="expectedRegistrationVersion" value={version}/></>;
}
