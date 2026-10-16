import { database } from "@/server/runtime.ts";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { currentPrivacyNotice, effectiveEventStatus } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { LeaderEventHero } from "../../../../../components/leader-event-hero.tsx";
import { ParticipantAvatar } from "../../../../../components/participant-avatar.tsx";
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
  const notice=await currentPrivacyNotice(database(),registration.eventId,"LEADER",locale);
  const result = (await searchParams).result;
  const active = registration.participants.filter(item => !["REMOVED", "REPLACED"].includes(item.status));
  const approved = active.filter(item => item.status === "LEADER_APPROVED");
  const zonesReady = registration.zones.length > 0;
  const vehicleReady = !registration.vehiclePass?.required || Boolean(registration.vehiclePass.justification?.trim());
  const workersReady = active.length > 0 && approved.length === active.length && active.length <= registration.personnelLimit;
  const complete = zonesReady && vehicleReady && workersReady;
  const eventOpen = effectiveEventStatus(registration.event) === "ONBOARDING_OPEN";
  const canSubmit = complete && registration.capabilities.submit;
  const canReopen = eventOpen && registration.status === "APPROVED";
  const latest = registration.submissions[0];
  const lastReview = latest?.reviews.at(-1);
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeZone: registration.event.timezone });
  const zoneNames = registration.zones.map(item => registration.event.zones.find(zone => zone.zoneId === item.zoneId)?.zone.name).filter((name): name is string => Boolean(name));
  const vehicleCount = registration.vehiclePass?.required ? registration.vehiclePass.requestedQuantity : 0;
  const statusHelp = registration.status === "APPROVED" ? t("statusApprovedHelp")
    : registration.status === "AIA_REVIEW" ? t("statusReviewHelp")
    : registration.status === "RETURNED_FOR_CORRECTION" ? t("statusReturnedHelp")
    : registration.status === "REJECTED" ? t("statusRejectedHelp")
    : t("statusDraftHelp");
  const summary = {
    company: registration.company.name,
    event: registration.event.name,
    dates: `${date.format(registration.event.startDate)} – ${date.format(registration.event.endDate)}`,
    zones: zoneNames,
    vehicle: { required: registration.vehiclePass?.required ?? false, quantity: registration.vehiclePass?.requestedQuantity ?? 0, justification: registration.vehiclePass?.justification ?? null },
    participants: active.map(person => ({ id: person.id, name: person.fullName ?? "—", role: person.jobRole?.name ?? "—", status: status(person.status), days: person.workDays.length, documentNumber: person.documentNumber, photoUrl: person.photoObjectKey ? `/api/participants/${person.id}/photo` : undefined })),
  };

  return <>
    <LeaderEventHero name={registration.event.name} startDate={registration.event.startDate} endDate={registration.event.endDate} locale={locale}/>
    <header className="submission-heading">
      <div><p className="section-kicker">{locale === "pt" ? "SUBMISSÃO FINAL" : "FINAL SUBMISSION"}</p><h1>{t("title")}</h1><p>{t("intro")}</p></div>
      <div className="submission-status"><div><StatusBadge value={registration.status}/><PortalIcon name="info" size={20}/></div><p>{statusHelp}</p></div>
    </header>
    {result && <p className={`flash ${["submitted", "reopened"].includes(result) ? "success" : "error"}`}>{resultMessage(result, t)}</p>}
    {lastReview && ["RETURNED_FOR_CORRECTION", "REJECTED"].includes(lastReview.outcome) && <section className="review-feedback"><strong>{status(lastReview.outcome)}</strong><span>{lastReview.reasonCategory}</span><p>{lastReview.comment}</p></section>}

    <div className="submission-layout">
      <section className="submission-summary-card">
        <header><h2>{t("summaryTitle")}</h2><SubmissionDetailsModal locale={locale} summary={summary} triggerLabel={t("viewSummary")} triggerClassName="submission-summary-trigger" triggerIcon/></header>
        <div className="submission-facts">
          <Fact icon="calendar" label={t("eventLabel")} value={registration.event.name} detail={summary.dates}/>
          <Fact icon="building" label={t("companyLabel")} value={registration.company.name}/>
          <Fact icon="pin" label={t("zonesLabel")} value={String(registration.zones.length)} detail={zoneNames.join(", ") || t("none")}/>
          <Fact icon="car" label={t("vehiclesLabel")} value={String(vehicleCount)} detail={registration.vehiclePass?.required ? t("vehicleRequested", { count: vehicleCount }) : t("notRequested")}/>
        </div>
        <Link className="submission-workers-row" href={`/${locale}/company/${registration.id}`}>
          <span className="submission-fact-icon"><PortalIcon name="people"/></span>
          <span><small>{t("workersLabel")}</small><strong>{approved.length} / {active.length}</strong><p>{t("approvedWorkers")}</p></span>
          <span className="submission-avatar-stack">{active.slice(0, 3).map(person => <ParticipantAvatar key={person.id} name={person.fullName} photoUrl={person.photoObjectKey ? `/api/participants/${person.id}/photo` : undefined} size="small"/>)}{active.length > 3 && <b>+{active.length - 3}</b>}</span>
          <PortalIcon name="arrow" size={19}/>
        </Link>
      </section>
      <aside className="submission-checklist">
        <header><h2>{t("checklist")}</h2><span className={complete ? "complete" : "incomplete"}>{complete ? t("checklistComplete") : t("checklistIncomplete")}</span></header><p>{t("checklistHelp")}</p>
        <Check ready={zonesReady} label={t("zonesReady")} detail={`${t("zonesSelected", { count: registration.zones.length })}${zoneNames.length ? ` (${zoneNames.join(", ")})` : ""}`} href={`/${locale}/company/${registration.id}`}/>
        <Check ready={vehicleReady} label={t("vehicleReady")} detail={registration.vehiclePass?.required ? t("vehicleRequested", { count: vehicleCount }) : t("notRequested")} href={`/${locale}/company/${registration.id}`}/>
        <Check ready={workersReady} label={t("workersReady")} detail={t("workersApproved", { approved: approved.length, total: active.length })} href={`/${locale}/company/${registration.id}`}/>
        {!eventOpen && <p className="submission-warning-copy">{t("deadlineClosed")}</p>}
      </aside>
    </div>
    <div className="submission-warning"><PortalIcon name="alert"/><div><strong>{t("lockWarningTitle")}</strong><p>{t("lockWarning")}</p></div></div>
    <div className="submission-actions">
      <Link className="button secondary" href={`/${locale}/company/${registration.id}`}>{t("saveDraft")}</Link>
      {canReopen ? <form action={reopenRegistrationAction}><Hidden locale={locale} registrationId={registration.id} version={registration.version}/><button className="button danger" type="submit">{t("reopen")}</button></form> : <form action={submitRegistrationAction} className="submission-consent-form"><Hidden locale={locale} registrationId={registration.id} version={registration.version}/><input type="hidden" name="dataProcessingNoticeHash" value={notice.hash}/><input type="hidden" name="dataProcessingNoticeVersion" value={notice.version}/><label className="submission-consent"><input type="checkbox" name="dataProcessingAccepted" required disabled={!canSubmit}/><span>{notice.text}</span></label><button className="button primary" type="submit" disabled={!canSubmit}>{registration.status === "AIA_REVIEW" ? t("underReview") : registration.status === "REJECTED" ? t("rejected") : registration.status === "APPROVED" ? t("approved") : t("submit")}</button></form>}
    </div>
  </>;
}

function Hidden({ locale, registrationId, version }: { locale: Locale; registrationId: string; version: number }) {
  return <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="expectedVersion" value={version}/></>;
}
function Fact({ icon, label, value, detail }: { icon: "calendar" | "building" | "pin" | "car"; label: string; value: string; detail?: string }) {
  return <article className="submission-fact"><span className="submission-fact-icon"><PortalIcon name={icon}/></span><div><small>{label}</small><strong>{value}</strong>{detail && <p>{detail}</p>}</div></article>;
}
function Check({ ready, label, detail, href }: { ready: boolean; label: string; detail: string; href: string }) { return <Link href={href} className={`checklist-row ${ready ? "ready" : "missing"}`}><PortalIcon name={ready ? "check" : "alert"}/><span><strong>{label}</strong><small>{detail}</small></span><PortalIcon name="arrow" size={18}/></Link>; }
function resultMessage(result: string, t: Awaited<ReturnType<typeof getTranslations<"submission">>>) {
  if (result === "submitted") return t("submitted");
  if (result === "reopened") return t("reopened");
  if (result === "submission_incomplete") return t("incomplete");
  if (result === "deadline_closed") return t("deadlineClosed");
  if (result === "stale_write") return t("staleWrite");
  return t("error");
}
