import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { ParticipantFields } from "../../../../../../components/participant-fields.tsx";
import { PortalIcon } from "../../../../../../components/portal-icon.tsx";
import { loadLeaderParticipant } from "../../../../../../server/portal-data.ts";
import { approveParticipantAction, saveParticipantAction } from "./actions.ts";

export default async function ParticipantPage({ params, searchParams }: { params: Promise<{ registrationId: string; participantId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("worker"), setup = await getTranslations("setup"), status = await getTranslations("status");
  const { registrationId, participantId } = await params;
  const { participant, jobRoles } = await loadLeaderParticipant(locale, participantId);
  const result = (await searchParams).result;
  const editable = !["REMOVED", "REPLACED"].includes(participant.status);
  const event = participant.registration.event;
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(value);
  return <>
    <div className="participant-page-heading"><Link className="participant-back" href={`/${locale}/company/${registrationId}`}><PortalIcon name="back" size={17}/>{t("backToWorkers")}</Link><p className="eyebrow">{participant.registration.company.name}</p><div><h1>{participant.fullName ?? t("editParticipant")}</h1><span className={`participant-status status-${participant.status.toLowerCase()}`}>{status(participant.status)}</span></div><p>{t("editParticipantHelp")}</p></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{setup(result === "saved" ? "saved" : "error")}</p>}
    {participant.status === "DUPLICATE_REVIEW_REQUIRED" && <p className="flash error">{t("duplicateSafe")}</p>}
    <section className="participant-event-strip"><div><span><PortalIcon name="calendar"/></span><strong>{event.name}</strong><small>{date(event.startDate)} – {date(event.endDate)}</small></div><div><PortalIcon name="pin"/><strong>Autódromo Internacional do Algarve</strong><small>Portimão, Portugal</small></div><div><PortalIcon name="briefcase"/><strong>{t("company")}</strong><small>{participant.registration.company.name}</small></div></section>
    <section className="participant-editor">
      {editable && <form action={saveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/>
        <ParticipantFields startDate={event.startDate} endDate={event.endDate} jobRoles={jobRoles} defaults={{ ...participant, workDays: participant.workDays.map(day => day.workDate) }} requirePhoto={!participant.photoObjectKey} existingPhotoUrl={participant.photoObjectKey ? `/api/participants/${participant.id}/photo` : undefined} privacy={!participant.privacyAcknowledgedAt ? "leader" : false}/>
        <footer className="participant-form-footer"><span><PortalIcon name="help" size={17}/>{t("requiredHelp")}</span><div><Link className="button secondary" href={`/${locale}/company/${registrationId}`}>{t("cancel")}</Link><button className="button primary">{t("save")}</button></div></footer>
      </form>}
      {participant.status === "AWAITING_LEADER_REVIEW" && <form action={approveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/><button className="button primary">{t("approve")}</button></form>}
    </section>
  </>;
}
