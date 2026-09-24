import { getLocale, getTranslations } from "next-intl/server";
import { DomainError, employeeInvitationView } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { ParticipantFields } from "../../../../components/participant-fields.tsx";
import { PortalIcon } from "../../../../components/portal-icon.tsx";
import { database } from "../../../../server/runtime.ts";
import { enforcePublicRateLimit } from "../../../../server/rate-limit.ts";
import { submitOnboardingAction } from "./actions.ts";

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("worker");
  const { token } = await params;
  const invitation = await (async () => {
    try { await enforcePublicRateLimit("employee-view", token, 30, 900); return await employeeInvitationView(database(), token); }
    catch (error) { if (error instanceof DomainError || error instanceof Error) return null; throw error; }
  })();
  if (!invitation) return <main className="onboarding-shell"><section className="onboarding-card"><h1>{t("unavailable")}</h1></section></main>;
  const result = (await searchParams).result;
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(value);
  return <main className="onboarding-shell"><section className="onboarding-card participant-onboarding-card">
    <div className="participant-page-heading"><p className="eyebrow">AIA / {invitation.companyName}</p><h1>{t("onboardingTitle")}</h1><p>{t("onboardingHelp")}</p></div>
    <section className="participant-event-strip"><div><span><PortalIcon name="calendar"/></span><strong>{invitation.eventName}</strong><small>{date(invitation.startDate)} – {date(invitation.endDate)}</small></div><div><PortalIcon name="pin"/><strong>Autódromo Internacional do Algarve</strong><small>Portimão, Portugal</small></div><div><PortalIcon name="briefcase"/><strong>{t("company")}</strong><small>{invitation.companyName}</small></div></section>
    {result === "error" && <p className="flash error">{t("invalid")}</p>}
    <form action={submitOnboardingAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="token" value={token}/>
      <ParticipantFields startDate={invitation.startDate} endDate={invitation.endDate} jobRoles={invitation.jobRoles} privacy/>
      <footer className="participant-form-footer"><span><PortalIcon name="help" size={17}/>{t("requiredHelp")}</span><button className="button primary onboarding-submit">{t("submit")}</button></footer>
    </form>
  </section></main>;
}
