import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { loadLeaderRegistration } from "../../../../server/portal-data.ts";
import { configureRegistrationAction } from "./actions.ts";
import { createParticipantAction, revokeEmployeeLinkAction } from "./actions.ts";
import { EmployeeLinkForm } from "../../../../components/employee-link-form.tsx";

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
  return <>
    <div className="page-title"><div><p className="eyebrow">{registration.company.name}</p><h1>{registration.event.name}</h1><p>{t("companyConfiguration")}</p></div><Link className="button secondary" href={`/${locale}/company`}>{t("back")}</Link></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{t(result === "saved" ? "saved" : "error")}</p>}
    <form action={configureRegistrationAction}>
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="expectedVersion" value={registration.version}/>
      <section className="card"><div className="section-heading"><h2>{t("companyZones")}</h2><span className="muted">{t("companyWide")}</span></div>
        <div className="checkbox-grid">{registration.event.zones.map(link => <label className="check-card" key={link.zoneId}><input type="checkbox" name="zoneIds" value={link.zoneId} defaultChecked={selected.has(link.zoneId)}/><span>{link.zone.name}</span></label>)}</div>
      </section>
      <section className="card"><div className="section-heading"><h2>{t("vehiclePass")}</h2></div>
        <label className="check-card"><input type="checkbox" name="vehicleRequired" defaultChecked={registration.vehiclePass?.required ?? false}/><span>{t("vehicleRequired")}</span></label>
        <div className="form-grid compact"><label>{t("requestedQuantity")}<input name="requestedQuantity" type="number" min="1" max="1000" defaultValue={registration.vehiclePass?.requestedQuantity || 1}/></label><label className="wide">{t("justification")}<textarea name="justification" maxLength={2000} defaultValue={registration.vehiclePass?.justification ?? ""}/></label></div>
      </section>
      <button className="button primary" type="submit">{t("saveConfiguration")}</button>
    </form>
    <section className="card"><div className="section-heading"><div><h2>{w("participants")}</h2><p className="small muted">{w("participantsHelp")}</p></div><span className="muted">{registration.participants.filter(participant => !["REMOVED", "REPLACED"].includes(participant.status)).length} / {registration.personnelLimit}</span></div>
      <form action={createParticipantAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><button className="button primary">{w("addParticipant")}</button></form>
      <div className="participant-list">{registration.participants.map(participant => {
        const invitation = participant.employeeTokens[0];
        const pendingInvitation = invitation && !invitation.usedAt && !invitation.revokedAt && invitation.expiresAt > new Date();
        return <article className="participant-row" key={participant.id}>
          <div><strong>{participant.fullName ?? w("addParticipant")}</strong><p className="small muted">{status(participant.status)}{participant.documentNumberLast3 ? ` · ${w("maskedDocument")} •••${participant.documentNumberLast3}` : ""}</p>{participant.status === "DUPLICATE_REVIEW_REQUIRED" && <p className="small warning-text">{w("duplicateSafe")}</p>}</div>
          <div className="participant-actions"><Link className="button secondary" href={`/${locale}/company/${registration.id}/participants/${participant.id}`}>{w("editParticipant")}</Link><EmployeeLinkForm locale={locale} participantId={participant.id} registrationId={registration.id} labels={{ generate: w("generateLink"), copy: w("copyLink"), ready: w("linkReady"), unavailable: w("linkUnavailable") }}/>{pendingInvitation && <form action={revokeEmployeeLinkAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="invitationId" value={invitation.id}/><button className="text-button">{t("revoke")}</button></form>}</div>
        </article>;
      })}</div>
    </section>
  </>;
}
