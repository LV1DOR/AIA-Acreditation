import { getCountries } from "libphonenumber-js";
import { getLocale, getTranslations } from "next-intl/server";

type Role = { id: string; name: string };
const DOCUMENT_TYPES = ["PASSPORT", "CARTAO_CIDADAO", "CARTAO_RESIDENCIA"] as const;
type Defaults = {
  fullName?: string | null;
  dateOfBirth?: Date | null;
  documentType?: string | null;
  documentNumberLast3?: string | null;
  documentExpiryDate?: Date | null;
  mobileE164?: string | null;
  nationalityCode?: string | null;
  jobRoleId?: string | null;
  workDays?: Date[];
  photoObjectKey?: string | null;
};

function dateValue(value?: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

function eventDays(start: Date, end: Date) {
  const days: string[] = [];
  for (let cursor = new Date(start); cursor <= end && days.length < 366; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

export async function ParticipantFields({ startDate, endDate, jobRoles, defaults = {}, privacy = false, requirePhoto = true }: {
  startDate: Date;
  endDate: Date;
  jobRoles: Role[];
  defaults?: Defaults;
  privacy?: boolean | "leader";
  requirePhoto?: boolean;
}) {
  const t = await getTranslations("worker");
  const locale = await getLocale();
  const selectedDays = new Set((defaults.workDays ?? []).map(dateValue));
  const countryNames = new Intl.DisplayNames([locale], { type: "region" });
  const countries = getCountries().map(code => ({ code, name: countryNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));

  return <>
    <div className="form-grid participant-form-grid">
      <label>{t("fullName")}<input name="fullName" required maxLength={200} defaultValue={defaults.fullName ?? ""}/></label>
      <label>{t("dateOfBirth")}<input name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} defaultValue={dateValue(defaults.dateOfBirth)}/></label>
      <label>{t("documentType")}<select name="documentType" required defaultValue={defaults.documentType ?? ""}><option value="" disabled>—</option>{DOCUMENT_TYPES.map(type => <option value={type} key={type}>{t(type)}</option>)}</select></label>
      <label>{t("documentNumber")}<input name="documentNumber" required={!defaults.documentNumberLast3} autoComplete="off" maxLength={100}/>{defaults.documentNumberLast3 && <span className="field-help">{t("documentNumberHelp")} {t("maskedDocument")} •••{defaults.documentNumberLast3}</span>}</label>
      <label>{t("documentExpiry")}<input name="documentExpiryDate" type="date" required min={dateValue(endDate)} defaultValue={dateValue(defaults.documentExpiryDate)}/><span className="field-help">{t("documentExpiryHelp", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(endDate) })}</span></label>
      <label>{t("mobile")}<input name="mobile" type="tel" inputMode="tel" placeholder="+351 912 345 678" required defaultValue={defaults.mobileE164 ?? ""}/></label>
      <label>{t("nationality")}<select name="nationalityCode" required defaultValue={defaults.nationalityCode ?? ""}><option value="" disabled>{t("selectNationality")}</option>{countries.map(country => <option value={country.code} key={country.code}>{country.name}</option>)}</select></label>
      <label>{t("jobRole")}<select name="jobRoleId" required defaultValue={defaults.jobRoleId ?? ""}><option value="" disabled>{t("selectRole")}</option>{jobRoles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
    </div>
    <fieldset className="work-days"><legend>{t("workingDays")}</legend><div className="checkbox-grid">{eventDays(startDate, endDate).map(day => <label className="check-card" key={day}><input type="checkbox" name="workDays" value={day} defaultChecked={selectedDays.has(day)}/><span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}</span></label>)}</div></fieldset>
    <label className="photo-field">{t("photo")}<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="user" required={requirePhoto}/><span className="field-help">{t("photoHelp")}</span></label>
    {privacy && <section className="privacy-placeholder"><h2>{t("privacyTitle")}</h2><p>{t("privacyTodo")}</p><label className="check-card"><input name="privacyAcknowledged" type="checkbox" required/><span>{t(privacy === "leader" ? "privacyAckLeader" : "privacyAck")}</span></label><input type="hidden" name="privacyNoticeVersion" value="TODO-v1"/></section>}
  </>;
}
