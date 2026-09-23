"use client";
import { useTranslations } from "next-intl";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations("auth");
  return <main className="auth-page"><h1>{t("error")}</h1><button className="button primary" onClick={reset}>{t("retry")}</button></main>;
}

