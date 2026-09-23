import { getTranslations } from "next-intl/server";
export default async function OnboardingCompletePage() {
  const t = await getTranslations("worker");
  return <main className="onboarding-shell"><section className="onboarding-card completion-card"><p className="eyebrow">AIA / ACCESS</p><h1>{t("submitted")}</h1><p>{t("submittedHelp")}</p></section></main>;
}
