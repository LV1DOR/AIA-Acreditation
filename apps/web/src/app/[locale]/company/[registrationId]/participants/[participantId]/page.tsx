import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { effectiveEventStatus } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { ParticipantFields } from "../../../../../../components/participant-fields.tsx";
import { PortalIcon } from "../../../../../../components/portal-icon.tsx";
import { loadLeaderParticipant } from "../../../../../../server/portal-data.ts";
import { approveParticipantAction, saveParticipantAction } from "./actions.ts";

export default async function ParticipantPage({ params, searchParams }: { params: Promise<{ registrationId: string; participantId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("worker"), setup = await getTranslations("setup"), status = await getTranslations("status");
  const { registrationId, participantId } = await params;
  const { participant, jobRoles, correction, capabilities } = await loadLeaderParticipant(locale, participantId);
  const result = (await searchParams).result;
  const event = participant.registration.event;
  const eventStatus = effectiveEventStatus(event);
  const editable = capabilities.editable;
  const deadline = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium", timeStyle: "short" }).format(event.onboardingClosesAt);
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(value);
  return <>
    <div className="participant-page-heading">{capabilities.canSaveDraft ? <button className="participant-back" type="submit" form="participant-editor-form" name="intent" value="back" formNoValidate><PortalIcon name="back" size={17}/>{t("backToWorkers")}</button> : <Link className="participant-back" href={`/${locale}/company/${registrationId}`}><PortalIcon name="back" size={17}/>{t("backToWorkers")}</Link>}<p className="eyebrow">{participant.registration.company.name}</p><div><h1>{participant.fullName ?? t("editParticipant")}</h1><span className={`participant-status status-${participant.status.toLowerCase()}`}>{status(participant.status)}</span></div><p>{t("editParticipantHelp")}</p></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{participantResult(result, setup, t)}</p>}
    {participant.status === "DUPLICATE_REVIEW_REQUIRED" && <p className="flash error">{t("duplicateSafe")}</p>}
    {correction && <section className="participant-correction-note"><span><PortalIcon name="alert"/></span><div><p className="section-kicker">{locale === "pt" ? "CORREÇÃO SOLICITADA PELA AIA" : "CORRECTION REQUESTED BY AIA"}</p><h2>{correctionReason(locale, correction.reasonCategory)}</h2><p>{correction.comment}</p></div></section>}
    {!editable && <div className="deadline-notice"><PortalIcon name="clock"/><div><strong>{eventStatus !== "ONBOARDING_OPEN" ? setup("deadlineClosed") : setup("registrationLocked")}</strong><span>{setup("deadlineValue", { deadline })}</span></div></div>}
    <section className="participant-event-strip"><div><span><PortalIcon name="calendar"/></span><strong>{event.name}</strong><small>{date(event.startDate)} – {date(event.endDate)}</small></div><div><PortalIcon name="pin"/><strong>Autódromo Internacional do Algarve</strong><small>Portimão, Portugal</small></div><div><PortalIcon name="briefcase"/><strong>{t("company")}</strong><small>{participant.registration.company.name}</small></div></section>
    <section className="participant-editor">
      <form id="participant-editor-form" action={saveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/><input type="hidden" name="expectedVersion" value={participant.version}/><fieldset className="participant-form-fields" disabled={!editable}>
        <ParticipantFields eventId={participant.eventId} editableFields={capabilities.fields} startDate={event.startDate} endDate={event.endDate} jobRoles={jobRoles} defaults={{ ...participant, workDays: participant.workDays.map(day => day.workDate) }} requirePhoto={!participant.photoObjectKey} existingPhotoUrl={participant.photoObjectKey ? `/api/participants/${participant.id}/photo` : undefined} privacy={!participant.privacyAcknowledgedAt ? "leader" : false}/>
      </fieldset><footer className="participant-form-footer"><span><PortalIcon name="help" size={17}/>{t("requiredHelp")}</span><div>{capabilities.canSaveDraft?<button className="button secondary" type="submit" name="intent" value="back" formNoValidate>{t("cancel")}</button>:<Link className="button secondary" href={`/${locale}/company/${registrationId}`}>{t("cancel")}</Link>}<button className="button primary" disabled={!editable}>{t("save")}</button></div></footer></form>
      {capabilities.canApprove && <form action={approveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/><button className="button primary">{t("approve")}</button></form>}
    </section>
  </>;
}

function correctionReason(locale: Locale, reason: string | null) {
  const labels: Record<string, { pt: string; en: string }> = {
    PHOTO: { pt: "Fotografia", en: "Photo" },
    IDENTITY: { pt: "Identificação", en: "Identity" },
    DOCUMENT: { pt: "Documento", en: "Document" },
    DUPLICATE: { pt: "Possível duplicado", en: "Possible duplicate" },
    HEADCOUNT: { pt: "Limite de pessoas", en: "Personnel limit" },
    ZONES: { pt: "Zonas", en: "Zones" },
    VEHICLE_PASS: { pt: "Passe de veículo", en: "Vehicle pass" },
    WORK_DAYS: { pt: "Dias de trabalho", en: "Work days" },
    OTHER: { pt: "Outro", en: "Other" },
  };
  return reason ? labels[reason]?.[locale] ?? reason : locale === "pt" ? "Dados da pessoa" : "Person details";
}

function participantResult(result: string, setup: Awaited<ReturnType<typeof getTranslations<"setup">>>, worker: Awaited<ReturnType<typeof getTranslations<"worker">>>) {
  if (result === "saved") return setup("saved");
  if (result === "deadline_closed") return setup("deadlineClosed");
  if (result === "edit_locked") return setup("registrationLocked");
  if (result === "invalid_input" || result === "submission_incomplete") return worker("invalid");
  if (result === "stale_write") return setup("staleWrite");
  if (result === "busy") return worker("retryLater");
  if (result === "privacy_notice_changed") return worker("privacyNoticeChanged");
  return setup("error");
}
