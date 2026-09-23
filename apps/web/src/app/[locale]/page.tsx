import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicHeader } from "../../components/public-header.tsx";
import { Notice } from "../../components/notice.tsx";
import { authConfigured } from "../../server/auth-config.ts";
export default async function Home() {
  const locale = await getLocale(), t = await getTranslations("home"), common = await getTranslations("common"), auth = await getTranslations("auth");
  const configured = authConfigured();
  return <><PublicHeader /><main className="landing">
    {!configured && <Notice title={auth("unconfiguredTitle")}><p>{auth("unconfiguredText")}</p></Notice>}
    <section className="hero"><div className="hero-copy"><p className="eyebrow">{t("eyebrow")}</p><h1>{t("title")}</h1><p className="intro">{t("intro")}</p>{configured ? <Link className="button primary" href={"/" + locale + "/portal"}>{common("signIn")} <span aria-hidden="true">↗</span></Link> : <span className="button secondary" aria-disabled="true">{common("signIn")}</span>}<p className="small muted">{t("access")}</p></div>
      <div className="hero-panel"><span className="panel-index">AIA / 01</span><div className="track-lines" aria-hidden="true"><i/><i/><i/></div><div className="panel-bottom"><p>{t("tag")}</p><strong>{t("footer")}</strong><span className="red-line"/></div></div></section>
    <section className="steps" aria-label={t("eyebrow")}>{[1,2,3].map(n => <article key={n}><span className="step-number">0{n}</span><h2>{t("step" + n)}</h2><p>{t("step" + n + "Text")}</p></article>)}</section>
    <section className="access-help"><article><h2>{t("invited")}</h2><p>{t("invitedText")}</p></article><article><h2>{t("worker")}</h2><p>{t("workerText")}</p></article></section>
  </main><footer className="public-footer"><span>{common("circuit")}</span><span>{common("secure")}</span></footer></>;
}
