"use client";

import { useId, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/en-gb.js";
import "dayjs/locale/pt.js";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { ptPT } from "@mui/x-date-pickers/locales";
import type { Locale } from "@aia/i18n";
import { PortalIcon } from "./portal-icon.tsx";

export function BirthDateCalendar({ defaultValue, label, locale, name }: { defaultValue?: string; label: string; locale: Locale; name: string }) {
  const id = useId();
  const initial = defaultValue ? dayjs(defaultValue) : null;
  const [value, setValue] = useState<Dayjs | null>(initial?.isValid() ? initial : null);
  const [open, setOpen] = useState(false);
  const localeText = locale === "pt" ? ptPT.components.MuiLocalizationProvider.defaultProps.localeText : undefined;
  const display = value ? new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value.format("YYYY-MM-DD")}T00:00:00Z`)) : locale === "pt" ? "Selecionar data" : "Choose date";

  return <div className="birth-date-field">
    <label id={`${id}-label`}>{label}</label>
    <input type="hidden" name={name} value={value?.format("YYYY-MM-DD") ?? ""}/>
    <button type="button" className="birth-date-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-required="true" onClick={() => setOpen(current => !current)}><span id={`${id}-value`}>{display}</span><PortalIcon name="calendar" size={19}/></button>
    {open && <div className="birth-date-popover" role="dialog" aria-modal="false" aria-label={label}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale === "pt" ? "pt" : "en-gb"} localeText={localeText}>
        <DateCalendar value={value} onChange={setValue} maxDate={dayjs().startOf("day")} openTo="year" views={["year", "day"]}/>
      </LocalizationProvider>
      <button type="button" className="text-button birth-date-close" onClick={() => setOpen(false)}>{locale === "pt" ? "Fechar" : "Close"}</button>
    </div>}
  </div>;
}
