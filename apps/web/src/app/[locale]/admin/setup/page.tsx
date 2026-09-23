import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { loadAdminSetup } from "../../../../server/portal-data.ts";
import { CompactDatePicker, CompactDatePickerProvider } from "../../../../components/compact-date-picker.tsx";
import { DeferredDetails } from "../../../../components/deferred-details.tsx";
import {
  activateEventZoneAction, createCompanyAction, createEventAction, createJobRoleAction,
  createRegistrationAction, createZoneAction, deactivateEventZoneAction, issueInvitationAction,
  revokeInvitationAction, updateCompanyAction, updateEventAction, updateJobRoleAction,
  updatePersonnelLimitAction, updateZoneAction,
} from "./actions.ts";

const dateValue = (date: Date) => date.toISOString().slice(0, 10);
const instantValue = (date: Date) => date.toISOString();
const hidden = (locale: Locale) => <input type="hidden" name="locale" value={locale}/>;

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("setup");
  const data = await loadAdminSetup(locale);
  const result = (await searchParams).result;
  return <CompactDatePickerProvider>
    <div className="page-title"><div><p className="eyebrow">AIA / {t("eyebrow")}</p><h1>{t("title")}</h1><p>{t("intro")}</p></div></div>
    {result && <p className={`flash ${result === "saved" ? "success" : "error"}`}>{t(result === "saved" ? "saved" : "error")}</p>}

    <section className="card" id="events"><div className="section-heading"><h2>{t("events")}</h2><span className="muted">{data.events.length}</span></div>
      <form action={createEventAction} className="form-grid">{hidden(locale)}
        <label>{t("name")}<input name="name" required maxLength={200}/></label>
        <label>{t("slug")}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*"/></label>
        <CompactDatePicker kind="date" name="startDate" label={t("startDate")} locale={locale}/>
        <CompactDatePicker kind="date" name="endDate" label={t("endDate")} locale={locale}/>
        <CompactDatePicker kind="datetime" name="onboardingOpensAt" label={t("opensAt")} locale={locale}/>
        <CompactDatePicker kind="datetime" name="onboardingClosesAt" label={t("closesAt")} locale={locale}/>
        <label>{t("timezone")}<input name="timezone" defaultValue="Europe/Lisbon" required/></label>
        <label>{t("publication")}<select name="publicationState" defaultValue="DRAFT"><option value="DRAFT">{t("draft")}</option><option value="PUBLISHED">{t("published")}</option></select></label>
        <button className="button primary" type="submit">{t("createEvent")}</button>
      </form>
      <div className="record-list">{data.events.map(event => <DeferredDetails key={event.id} summary={<><strong>{event.name}</strong><span>{event.status === "DRAFT" || event.status === "ARCHIVED" ? t("draft") : t("published")} · v{event.version}</span></>}>
        <form action={updateEventAction} className="form-grid compact">{hidden(locale)}<input type="hidden" name="id" value={event.id}/><input type="hidden" name="expectedVersion" value={event.version}/>
          <label>{t("name")}<input name="name" defaultValue={event.name} required/></label><label>{t("slug")}<input name="slug" defaultValue={event.slug ?? ""}/></label>
          <CompactDatePicker kind="date" name="startDate" label={t("startDate")} locale={locale} defaultValue={dateValue(event.startDate)}/><CompactDatePicker kind="date" name="endDate" label={t("endDate")} locale={locale} defaultValue={dateValue(event.endDate)}/>
          <CompactDatePicker kind="datetime" name="onboardingOpensAt" label={t("opensAt")} locale={locale} defaultValue={instantValue(event.onboardingOpensAt)}/><CompactDatePicker kind="datetime" name="onboardingClosesAt" label={t("closesAt")} locale={locale} defaultValue={instantValue(event.onboardingClosesAt)}/>
          <label>{t("timezone")}<input name="timezone" defaultValue={event.timezone} required/></label><label>{t("publication")}<select name="publicationState" defaultValue={event.status === "DRAFT" || event.status === "ARCHIVED" ? "DRAFT" : "PUBLISHED"}><option value="DRAFT">{t("draft")}</option><option value="PUBLISHED">{t("published")}</option></select></label>
          <button className="button secondary" type="submit">{t("save")}</button>
        </form>
        <p className="small muted">{t("activeZones")}: {event.zones.filter(link => !link.deactivatedAt).map(link => link.zone.name).join(", ") || "—"}</p>
      </DeferredDetails>)}</div>
    </section>

    <div className="two-columns">
      <section className="card" id="zones"><div className="section-heading"><h2>{t("zones")}</h2></div>
        <form action={createZoneAction} className="inline-form">{hidden(locale)}<input name="name" aria-label={t("name")} placeholder={t("name")} required/><button className="button primary">{t("add")}</button></form>
        <div className="record-list">{data.zones.map(zone => <form action={updateZoneAction} className="inline-form" key={zone.id}>{hidden(locale)}<input type="hidden" name="id" value={zone.id}/><input type="hidden" name="expectedVersion" value={zone.version}/><input type="hidden" name="sortOrder" value={zone.sortOrder}/><input name="name" defaultValue={zone.name} required/><label className="check"><input type="checkbox" name="active" defaultChecked={!zone.deactivatedAt}/>{t("active")}</label><button className="button secondary">{t("save")}</button></form>)}</div>
      </section>
      <section className="card" id="roles"><div className="section-heading"><h2>{t("jobRoles")}</h2></div>
        <form action={createJobRoleAction} className="inline-form">{hidden(locale)}<input name="name" aria-label={t("name")} placeholder={t("name")} required/><button className="button primary">{t("add")}</button></form>
        <div className="record-list">{data.jobRoles.map(role => <form action={updateJobRoleAction} className="inline-form" key={role.id}>{hidden(locale)}<input type="hidden" name="id" value={role.id}/><input type="hidden" name="expectedVersion" value={role.version}/><input type="hidden" name="sortOrder" value={role.sortOrder}/><input name="name" defaultValue={role.name} required/><label className="check"><input type="checkbox" name="active" defaultChecked={!role.deactivatedAt}/>{t("active")}</label><button className="button secondary">{t("save")}</button></form>)}</div>
      </section>
    </div>

    <section className="card" id="event-zones"><div className="section-heading"><h2>{t("eventZones")}</h2></div>
      <form action={activateEventZoneAction} className="inline-form">{hidden(locale)}<select name="eventId" required><option value="">{t("selectEvent")}</option>{data.events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select><select name="zoneId" required><option value="">{t("selectZone")}</option>{data.zones.filter(zone => !zone.deactivatedAt).map(zone => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select><button className="button primary">{t("activate")}</button></form>
      <div className="chips">{data.events.flatMap(event => event.zones.filter(link => !link.deactivatedAt).map(link => <form action={deactivateEventZoneAction} key={link.id}>{hidden(locale)}<input type="hidden" name="eventId" value={event.id}/><input type="hidden" name="zoneId" value={link.zoneId}/><button className="chip" title={t("deactivate")}>{event.name}: {link.zone.name} ×</button></form>))}</div>
    </section>

    <section className="card" id="companies"><div className="section-heading"><h2>{t("companies")}</h2><span className="muted">{data.companies.length}</span></div>
      <form action={createCompanyAction} className="inline-form">{hidden(locale)}<input name="name" placeholder={t("companyName")} required/><button className="button primary">{t("createCompany")}</button></form>
      <div className="record-list">{data.companies.map(company => <form action={updateCompanyAction} className="inline-form" key={company.id}>{hidden(locale)}<input type="hidden" name="id" value={company.id}/><input type="hidden" name="expectedVersion" value={company.version}/><input name="name" defaultValue={company.name} required/><label className="check"><input type="checkbox" name="active" defaultChecked={!company.deactivatedAt}/>{t("active")}</label><button className="button secondary">{t("save")}</button></form>)}</div>
    </section>

    <section className="card" id="registrations"><div className="section-heading"><h2>{t("registrations")}</h2><span className="muted">{data.registrations.length}</span></div>
      <form action={createRegistrationAction} className="inline-form">{hidden(locale)}<select name="eventId" required><option value="">{t("selectEvent")}</option>{data.events.filter(event => event.status !== "ARCHIVED").map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select><select name="companyId" required><option value="">{t("selectCompany")}</option>{data.companies.filter(company => !company.deactivatedAt).map(company => <option value={company.id} key={company.id}>{company.name}</option>)}</select><input name="personnelLimit" type="number" min="1" max="10000" defaultValue="10" aria-label={t("personnelLimit")}/><button className="button primary">{t("createRegistration")}</button></form>
      <div className="record-list">{data.registrations.map(registration => <details key={registration.id}><summary><strong>{registration.company.name}</strong><span>{registration.event.name} · {registration.status}</span></summary>
        <div className="form-grid compact">
          <form action={updatePersonnelLimitAction} className="inline-form">{hidden(locale)}<input type="hidden" name="registrationId" value={registration.id}/><input type="hidden" name="expectedVersion" value={registration.version}/><label>{t("personnelLimit")}<input name="personnelLimit" type="number" min="1" max="10000" defaultValue={registration.personnelLimit}/></label><button className="button secondary">{t("save")}</button></form>
          <form action={issueInvitationAction} className="inline-form">{hidden(locale)}<input type="hidden" name="registrationId" value={registration.id}/><input name="email" type="email" placeholder={t("leaderEmail")} required/><input name="expiryDays" type="number" min="1" max="30" defaultValue="7" aria-label={t("expiryDays")}/><button className="button primary">{t("sendInvitation")}</button></form>
        </div>
        {registration.invitations.length > 0 && <div className="invitation-list">{registration.invitations.map(invitation => <div key={invitation.id}><span>{invitation.emailNormalized}</span><span>{invitation.usedAt ? t("used") : invitation.revokedAt ? t("revoked") : invitation.expiresAt <= new Date() ? t("expired") : t("pending")}</span>{!invitation.usedAt && !invitation.revokedAt && invitation.expiresAt > new Date() && <form action={revokeInvitationAction}>{hidden(locale)}<input type="hidden" name="invitationId" value={invitation.id}/><button className="text-button">{t("revoke")}</button></form>}</div>)}</div>}
      </details>)}</div>
    </section>
  </CompactDatePickerProvider>;
}
