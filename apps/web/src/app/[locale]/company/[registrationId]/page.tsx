import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DomainError, effectiveEventStatus } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { loadLeaderRegistration } from "../../../../server/portal-data.ts";
import { approveParticipantFromTeamAction, configureRegistrationAction, revokeEmployeeLinkAction } from "./actions.ts";
import { AddParticipantModal } from "../../../../components/add-participant-modal.tsx";
import { LeaderEventHero } from "../../../../components/leader-event-hero.tsx";
import { ParticipantProfileModal, type ParticipantProfile } from "../../../../components/participant-profile-modal.tsx";
import { PortalIcon } from "../../../../components/portal-icon.tsx";

export default async function RegistrationPage({ params, searchParams }: { params: Promise<{ registrationId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("setup");
  const w = await getTranslations("worker");
  const status = await getTranslations("status");
  const { registrationId } = await params;
  const registration = await loadLeaderRegistration(locale, registrationId).catch(error => {
    if (error instanceof DomainError && error.code === "FORBIDDEN") notFound();
    throw error;
  });
  const selected = new Set(registration.zones.map(zone => zone.zoneId));
  const result = (await searchParams).result;
  const eventStatus = effectiveEventStatus(registration.event);
  const editable = eventStatus === "ONBOARDING_OPEN" && ["DRAFT", "RETURNED_FOR_CORRECTION"].includes(registration.status);
  const personOnlyCorrection = registration.status === "RETURNED_FOR_CORRECTION" && Boolean(registration.submissions[0]?.participantReviews.some(review => review.outcome === "RETURNED_FOR_CORRECTION"));
  const configurationEditable = editable && !personOnlyCorrection;
  const deadline = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium", timeStyle: "short" }).format(registration.event.onboardingClosesAt);
  const activeParticipants = registration.participants.filter(participant => !["REMOVED", "REPLACED"].includes(participant.status));
  const date = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const countries = new Intl.DisplayNames([locale === "pt" ? "pt-PT" : "en-GB"], { type: "region" });

  return <>
    <LeaderEventHero name={registration.event.name} startDate={registration.event.startDate} endDate={registration.event.endDate} locale={locale}/>
    <div className="leader-page-heading"><div><p>{locale === "pt" ? "EMPRESA" : "COMPANY"}</p><h1>{registration.company.name}</h1><span>{t("companyConfiguration")}</span></div></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{registrationResult(result, t)}</p>}
    {!editable && <div className="deadline-notice"><PortalIcon name="clock"/><div><strong>{eventStatus !== "ONBOARDING_OPEN" ? t("deadlineClosed") : t("registrationLocked")}</strong><span>{t("deadlineValue", { deadline })}</span></div></div>}

    <form action={configureRegistrationAction} className="card registration-configuration">
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="expectedVersion" value={registration.version}/>
      <fieldset disabled={!configurationEditable}>
        <header className="participation-heading"><span><PortalIcon name="document"/></span><div><h2>{locale === "pt" ? "Participação da empresa" : "Company participation"}</h2><p>{locale === "pt" ? "Estas definições aplicam-se a toda a empresa neste evento." : "These settings apply to the whole company for this event."}</p></div></header>
        <div className="configuration-grid">
          <section className="configuration-card"><div className="section-heading"><div><p className="section-kicker">{locale === "pt" ? "ZONAS" : "ZONES"}</p><h2>{t("companyZones")}</h2></div><span className="muted">{t("companyWide")}</span></div>
            <div className="checkbox-grid">{registration.event.zones.map(link => <label className="check-card" key={link.zoneId}><input type="checkbox" name="zoneIds" value={link.zoneId} defaultChecked={selected.has(link.zoneId)}/><span><strong>{link.zone.name}</strong><small>{t("zoneForTeam")}</small></span></label>)}</div>
          </section>
          <section className="configuration-card"><div className="section-heading"><div><p className="section-kicker">{locale === "pt" ? "VEÍCULO" : "VEHICLE"}</p><h2>{t("vehiclePass")}</h2></div><PortalIcon name="car"/></div>
            <label className="check-card vehicle-toggle"><input type="checkbox" name="vehicleRequired" defaultChecked={registration.vehiclePass?.required ?? false}/><span><strong>{t("vehicleRequired")}</strong><small>{t("vehicleHelp")}</small></span></label>
            <div className="form-grid compact"><label>{t("requestedQuantity")}<input name="requestedQuantity" type="number" min="1" max="1000" defaultValue={registration.vehiclePass?.requestedQuantity || 1}/></label><label className="wide">{t("justification")}<textarea name="justification" maxLength={2000} defaultValue={registration.vehiclePass?.justification ?? ""}/></label></div>
          </section>
        </div>
        <div className="configuration-footer"><button className="button primary configuration-save" type="submit" disabled={!configurationEditable}><PortalIcon name="document"/>{t("saveConfiguration")}</button></div>
      </fieldset>
    </form>

    <section className="card leader-workers-card" id="workers"><div className="workers-card-heading"><div className="workers-title"><span><PortalIcon name="people"/></span><div><p className="section-kicker">{locale === "pt" ? "EQUIPA" : "TEAM"}</p><h2>{locale === "pt" ? "Trabalhadores" : "Workers"}</h2><p>{w("participantsHelp")}</p></div></div><div className="workers-header-actions"><div className="headcount"><strong>{activeParticipants.length}</strong><span>/ {registration.personnelLimit}<small>{locale === "pt" ? "Adicionados" : "Added"}</small></span></div><AddParticipantModal locale={locale} registrationId={registration.id} disabled={!editable || personOnlyCorrection}/></div></div>
      {activeParticipants.length ? <div className="participant-list">{activeParticipants.map(participant => {
        const invitation = participant.employeeTokens[0];
        const pendingInvitation = invitation && !invitation.usedAt && !invitation.revokedAt && invitation.expiresAt > new Date();
        const profile: ParticipantProfile = {
          id: participant.id, name: participant.fullName ?? w("addParticipant"), status: participant.status, statusLabel: status(participant.status),
          documentNumber: participant.documentNumber, dateOfBirth: participant.dateOfBirth ? date.format(participant.dateOfBirth) : null,
          documentType: participant.documentType ? w(participant.documentType) : null, documentExpiry: participant.documentExpiryDate ? date.format(participant.documentExpiryDate) : null,
          mobile: participant.mobileE164, nationalityCode: participant.nationalityCode, nationality: participant.nationalityCode ? countries.of(participant.nationalityCode) ?? participant.nationalityCode : null,
          jobRole: participant.jobRole?.name ?? null, workDays: participant.workDays.map(day => date.format(day.workDate)), privacyAcknowledged: Boolean(participant.privacyAcknowledgedAt),
          photoUrl: participant.photoObjectKey ? `/api/participants/${participant.id}/photo` : undefined,
        };
        const returnedCorrection=registration.status === "RETURNED_FOR_CORRECTION" && participant.status === "AWAITING_LEADER_REVIEW";
        const participantEditable=(editable && (registration.status === "DRAFT" || participant.status !== "LEADER_APPROVED")) || returnedCorrection || (participant.replacementRequest?.status === "APPROVED" && !participant.replacementRequest.fulfilledBySubmissionId);
        return <article className="participant-row" key={participant.id}>
          <ParticipantProfileModal locale={locale} registrationId={registration.id} participant={profile} editable={participantEditable}/>
          <span className={`participant-status status-${participant.status.toLowerCase()}`}><PortalIcon name={participant.status === "LEADER_APPROVED" ? "check" : participant.status === "DUPLICATE_REVIEW_REQUIRED" ? "alert" : "clock"} size={17}/>{status(participant.status)}</span>
          <div className="participant-actions">{participantEditable && participant.status === "AWAITING_LEADER_REVIEW" && <form action={approveParticipantFromTeamAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="participantId" value={participant.id}/><button className="button primary">{w("approve")}</button></form>} {participantEditable && pendingInvitation && <form action={revokeEmployeeLinkAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="invitationId" value={invitation.id}/><button className="text-button">{t("revoke")}</button></form>}</div>
        </article>;
      })}</div> : <p className="leader-empty-line"><PortalIcon name="people"/>{w("participantsHelp")}</p>}
    </section>
  </>;
}

function registrationResult(result: string, t: Awaited<ReturnType<typeof getTranslations<"setup">>>) {
  if (result === "saved") return t("saved");
  if (result === "removed") return t("participantRemoved");
  if (result === "deadline_closed") return t("deadlineClosed");
  if (result === "edit_locked") return t("registrationLocked");
  if (result === "stale_write") return t("staleWrite");
  return t("error");
}
