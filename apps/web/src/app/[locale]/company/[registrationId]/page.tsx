import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DomainError } from "@aia/domain";
import type { Locale } from "@aia/i18n";
import { loadLeaderRegistration } from "../../../../server/portal-data.ts";
import { configureRegistrationAction } from "./actions.ts";

export default async function RegistrationPage({ params, searchParams }: { params: Promise<{ registrationId: string }>; searchParams: Promise<{ result?: string }> }) {
  const locale = await getLocale() as Locale;
  const t = await getTranslations("setup");
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
  </>;
}
