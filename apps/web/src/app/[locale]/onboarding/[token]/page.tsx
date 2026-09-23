import { getLocale, getTranslations } from "next-intl/server";
import { DomainError, employeeInvitationView } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { ParticipantFields } from "../../../../components/participant-fields.tsx";
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
  return <main className="onboarding-shell"><section className="onboarding-card">
    <p className="eyebrow">AIA / {invitation.eventName}</p><h1>{invitation.companyName}</h1>
    {result === "error" && <p className="flash error">{t("invalid")}</p>}
    <form action={submitOnboardingAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="token" value={token}/>
      <ParticipantFields startDate={invitation.startDate} endDate={invitation.endDate} jobRoles={invitation.jobRoles} privacy/>
      <button className="button primary onboarding-submit">{t("submit")}</button>
    </form>
  </section></main>;
}
