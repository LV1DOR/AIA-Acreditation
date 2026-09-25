import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { effectiveEventStatus } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { LeaderEventHero } from "../../../../../components/leader-event-hero.tsx";
import { PortalIcon } from "../../../../../components/portal-icon.tsx";
import { StatusBadge } from "../../../../../components/status-badge.tsx";
import { SubmissionDetailsModal } from "../../../../../components/submission-details-modal.tsx";
import { loadLeaderRegistration } from "../../../../../server/portal-data.ts";
import { reopenRegistrationAction, submitRegistrationAction } from "./actions.ts";

export default async function FinalSubmissionPage({ params, searchParams }: { params: Promise<{ registrationId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("submission");
  const status = await getTranslations("status");
  const { registrationId } = await params;
  const registration = await loadLeaderRegistration(locale, registrationId);
  const result = (await searchParams).result;
  const active = registration.participants.filter(item => !["REMOVED", "REPLACED"].includes(item.status));
  const approved = active.filter(item => item.status === "LEADER_APPROVED");
  const zonesReady = registration.zones.length > 0;
  const vehicleReady = !registration.vehiclePass?.required || Boolean(registration.vehiclePass.justification?.trim());
  const workersReady = active.length > 0 && approved.length === active.length && active.length <= registration.personnelLimit;
  const complete = zonesReady && vehicleReady && workersReady;
  const eventOpen = effectiveEventStatus(registration.event) === "ONBOARDING_OPEN";
  const canSubmit = complete && eventOpen && ["DRAFT", "RETURNED_FOR_CORRECTION"].includes(registration.status);
  const canReopen = eventOpen && registration.status === "APPROVED";
  const latest = registration.submissions[0];
  const lastReview = latest?.reviews.at(-1);
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeZone: registration.event.timezone });
  const summary = {
    company: registration.company.name,
    event: registration.event.name,
    dates: `${date.format(registration.event.startDate)} – ${date.format(registration.event.endDate)}`,
    zones: registration.zones.map(item => registration.event.zones.find(zone => zone.zoneId === item.zoneId)?.zone.name).filter((name): name is string => Boolean(name)),
    vehicle: { required: registration.vehiclePass?.required ?? false, quantity: registration.vehiclePass?.requestedQuantity ?? 0, justification: registration.vehiclePass?.justification ?? null },
    participants: active.map(person => ({ id: person.id, name: person.fullName ?? "—", role: person.jobRole?.name ?? "—", status: status(person.status), days: person.workDays.length, documentLast3: person.documentNumberLast3 })),
  };

  return <>
    <LeaderEventHero name={registration.event.name} startDate={registration.event.startDate} endDate={registration.event.endDate} locale={locale}/>
    <header className="submission-heading"><div><p className="section-kicker">SUBMISSÃO FINAL / FINAL SUBMISSION</p><h1>{t("title")}</h1><p>{t("intro")}</p></div><StatusBadge value={registration.status}/></header>
    {result && <p className={`flash ${["submitted", "reopened"].includes(result) ? "success" : "error"}`}>{resultMessage(result, t)}</p>}
    {lastReview && ["RETURNED_FOR_CORRECTION", "REJECTED"].includes(lastReview.outcome) && <section className="review-feedback"><strong>{status(lastReview.outcome)}</strong><span>{lastReview.reasonCategory}</span><p>{lastReview.comment}</p></section>}

    <div className="submission-layout">
      <div className="submission-summary">
        <section className="card review-block"><div><p className="section-kicker">EVENTO / EVENT</p><h2>{registration.event.name}</h2></div><PortalIcon name="calendar"/></section>
        <section className="card review-block"><div><p className="section-kicker">EMPRESA / COMPANY</p><h2>{registration.company.name}</h2></div><SubmissionDetailsModal locale={locale} summary={summary}/></section>
        <section className="card review-block"><div><p className="section-kicker">ZONAS / ZONES</p><h2>{registration.zones.length}</h2><p>{registration.zones.map(item => registration.event.zones.find(zone => zone.zoneId === item.zoneId)?.zone.name).filter(Boolean).join(", ") || t("none")}</p></div><PortalIcon name="pin"/></section>
        <section className="card review-block"><div><p className="section-kicker">VEÍCULOS / VEHICLES</p><h2>{registration.vehiclePass?.required ? registration.vehiclePass.requestedQuantity : 0}</h2><p>{registration.vehiclePass?.required ? registration.vehiclePass.justification : t("notRequested")}</p></div><PortalIcon name="car"/></section>
        <section className="card review-block"><div><p className="section-kicker">TRABALHADORES / WORKERS</p><h2>{approved.length} / {active.length}</h2><p>{t("approvedWorkers")}</p></div><SubmissionDetailsModal locale={locale} summary={summary}/></section>
      </div>
      <aside className="card submission-checklist"><h2>{t("checklist")}</h2><p>{t("checklistHelp")}</p>
        <Check ready={zonesReady} label={t("zonesReady")}/><Check ready={vehicleReady} label={t("vehicleReady")}/><Check ready={workersReady} label={t("workersReady")}/>
        {!eventOpen && <p className="submission-warning-copy">{t("deadlineClosed")}</p>}
      </aside>
    </div>
    <div className="submission-warning"><PortalIcon name="alert"/><div><strong>{t("lockWarningTitle")}</strong><p>{t("lockWarning")}</p></div></div>
    <div className="submission-actions">
      <Link className="button secondary" href={`/${locale}/company/${registration.id}`}>{t("saveDraft")}</Link>
      {canReopen ? <form action={reopenRegistrationAction}><Hidden locale={locale} registrationId={registration.id} version={registration.version}/><button className="button danger" type="submit">{t("reopen")}</button></form> : <form action={submitRegistrationAction}><Hidden locale={locale} registrationId={registration.id} version={registration.version}/><button className="button primary" type="submit" disabled={!canSubmit}>{registration.status === "AIA_REVIEW" ? t("underReview") : registration.status === "REJECTED" ? t("rejected") : registration.status === "APPROVED" ? t("approved") : t("submit")}</button></form>}
    </div>
    {latest && <p className="snapshot-reference">{t("snapshot", { version: latest.version, hash: latest.contentHash.slice(0, 12) })}</p>}
  </>;
}

function Hidden({ locale, registrationId, version }: { locale: Locale; registrationId: string; version: number }) {
  return <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="expectedVersion" value={version}/></>;
}
function Check({ ready, label }: { ready: boolean; label: string }) { return <div className={`checklist-row ${ready ? "ready" : "missing"}`}><PortalIcon name={ready ? "check" : "alert"}/><span>{label}</span></div>; }
function resultMessage(result: string, t: Awaited<ReturnType<typeof getTranslations<"submission">>>) {
  if (result === "submitted") return t("submitted");
  if (result === "reopened") return t("reopened");
  if (result === "submission_incomplete") return t("incomplete");
  if (result === "deadline_closed") return t("deadlineClosed");
  if (result === "stale_write") return t("staleWrite");
  return t("error");
}
