import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@aia/i18n";
import { BirthDateCalendar } from "./birth-date-calendar.tsx";
import { CountryDropdown } from "./ui/country-dropdown.tsx";
import { PhoneNumberField } from "./phone-number-field.tsx";
import { SingleImageUpload } from "./single-image-upload.tsx";
import { PortalIcon } from "./portal-icon.tsx";

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

export async function ParticipantFields({ startDate, endDate, jobRoles, defaults = {}, privacy = false, requirePhoto = true, existingPhotoUrl }: {
  startDate: Date;
  endDate: Date;
  jobRoles: Role[];
  defaults?: Defaults;
  privacy?: boolean | "leader";
  requirePhoto?: boolean;
  existingPhotoUrl?: string;
}) {
  const t = await getTranslations("worker");
  const locale = await getLocale() as Locale;
  const selectedDays = new Set((defaults.workDays ?? []).map(dateValue));

  return <div className="participant-sections">
    <section className="participant-section"><header className="participant-section-heading"><span><PortalIcon name="people" size={18}/></span><h2>1. {t("personalSection")}</h2><p>{t("personalSectionHelp")}</p></header><div className="form-grid participant-form-grid">
      <label>{t("fullName")}<input name="fullName" required maxLength={200} defaultValue={defaults.fullName ?? ""}/></label>
      <BirthDateCalendar name="dateOfBirth" label={t("dateOfBirth")} locale={locale} defaultValue={dateValue(defaults.dateOfBirth)} maxDate={dateValue(new Date())}/>
    </div></section>
    <section className="participant-section"><header className="participant-section-heading"><span><PortalIcon name="id" size={18}/></span><h2>2. {t("identificationSection")}</h2><p>{t("identificationSectionHelp")}</p></header><div className="form-grid participant-form-grid">
      <label>{t("documentType")}<select name="documentType" required defaultValue={defaults.documentType ?? ""}><option value="" disabled>—</option>{DOCUMENT_TYPES.map(type => <option value={type} key={type}>{t(type)}</option>)}</select></label>
      <label>{t("documentNumber")}<input name="documentNumber" required={!defaults.documentNumberLast3} autoComplete="off" maxLength={100}/>{defaults.documentNumberLast3 && <span className="field-help">{t("documentNumberHelp")} {t("maskedDocument")} •••{defaults.documentNumberLast3}</span>}</label>
      <BirthDateCalendar name="documentExpiryDate" label={t("documentExpiry")} locale={locale} defaultValue={dateValue(defaults.documentExpiryDate)} minDate={dateValue(endDate)} maxDate="2100-12-31" help={t("documentExpiryHelp", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(endDate) })}/>
      <PhoneNumberField name="mobile" label={t("mobile")} defaultValue={defaults.mobileE164 ?? undefined}/>
    </div></section>
    <section className="participant-section"><header className="participant-section-heading"><span><PortalIcon name="briefcase" size={18}/></span><h2>3. {t("workSection")}</h2><p>{t("workSectionHelp")}</p></header><div className="form-grid participant-form-grid">
      <CountryDropdown name="nationalityCode" label={t("nationality")} locale={locale} defaultValue={defaults.nationalityCode ?? undefined} emptyText={t("selectNationality")} searchText={t("searchNationality")}/>
      <label>{t("jobRole")}<select name="jobRoleId" required defaultValue={defaults.jobRoleId ?? ""}><option value="" disabled>{t("selectRole")}</option>{jobRoles.map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
    </div><fieldset className="work-days"><legend>{t("workingDays")}</legend><p>{t("workingDaysHelp")}</p><div className="checkbox-grid">{eventDays(startDate, endDate).map(day => <label className="check-card" key={day}><input type="checkbox" name="workDays" value={day} defaultChecked={selectedDays.has(day)}/><span>{new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}</span></label>)}</div></fieldset></section>
    <section className="participant-section"><header className="participant-section-heading"><span><PortalIcon name="camera" size={18}/></span><h2>4. {t("photoSection")}</h2><p>{t("photoSectionHelp")}</p></header>{existingPhotoUrl && <img className="participant-photo" src={existingPhotoUrl} alt=""/>}<SingleImageUpload name="photo" label={t("photo")} prompt={t("photoDrop")} help={t("photoHelp")} required={requirePhoto}/></section>
    {privacy && <section className="participant-section"><header className="participant-section-heading"><span><PortalIcon name="shield" size={18}/></span><h2>5. {t("privacySection")}</h2></header><div className="privacy-placeholder"><h3>{t("privacyTitle")}</h3><p>{t("privacyTodo")}</p><label className="check-card"><input name="privacyAcknowledged" type="checkbox" required/><span>{t(privacy === "leader" ? "privacyAckLeader" : "privacyAck")}</span></label><input type="hidden" name="privacyNoticeVersion" value="TODO-v1"/></div></section>}
  </div>;
}
