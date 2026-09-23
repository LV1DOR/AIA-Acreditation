import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { ParticipantFields } from "../../../../../../components/participant-fields.tsx";
import { loadLeaderParticipant } from "../../../../../../server/portal-data.ts";
import { approveParticipantAction, saveParticipantAction } from "./actions.ts";

export default async function ParticipantPage({ params, searchParams }: { params: Promise<{ registrationId: string; participantId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("worker"), setup = await getTranslations("setup"), status = await getTranslations("status");
  const { registrationId, participantId } = await params;
  const { participant, jobRoles } = await loadLeaderParticipant(locale, participantId);
  const result = (await searchParams).result;
  const editable = !["REMOVED", "REPLACED"].includes(participant.status);
  return <>
    <div className="page-title"><div><p className="eyebrow">{participant.registration.company.name}</p><h1>{participant.fullName ?? t("editParticipant")}</h1><p>{status(participant.status)}</p></div><Link className="button secondary" href={`/${locale}/company/${registrationId}`}>{setup("back")}</Link></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{setup(result === "saved" ? "saved" : "error")}</p>}
    {participant.status === "DUPLICATE_REVIEW_REQUIRED" && <p className="flash error">{t("duplicateSafe")}</p>}
    <section className="card participant-editor">
      {/* This authenticated endpoint is intentionally not sent through the Next image optimizer. */}
      {participant.photoObjectKey && <img className="participant-photo" src={`/api/participants/${participant.id}/photo`} alt=""/>}
      {editable && <form action={saveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/>
        <ParticipantFields startDate={participant.registration.event.startDate} endDate={participant.registration.event.endDate} jobRoles={jobRoles} defaults={{ ...participant, workDays: participant.workDays.map(day => day.workDate) }} requirePhoto={!participant.photoObjectKey} privacy={!participant.privacyAcknowledgedAt ? "leader" : false}/>
        <button className="button primary">{t("save")}</button>
      </form>}
      {participant.status === "AWAITING_LEADER_REVIEW" && <form action={approveParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participant.id}/><button className="button primary">{t("approve")}</button></form>}
    </section>
  </>;
}
