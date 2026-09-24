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

export function BirthDateCalendar({ defaultValue, help, label, locale, maxDate, minDate, name }: { defaultValue?: string; help?: string; label: string; locale: Locale; maxDate?: string; minDate?: string; name: string }) {
  const id = useId();
  const initial = defaultValue ? dayjs(defaultValue) : null;
  const [value, setValue] = useState<Dayjs | null>(initial?.isValid() ? initial : null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"day" | "year">("day");
  const localeText = locale === "pt" ? ptPT.components.MuiLocalizationProvider.defaultProps.localeText : undefined;
  const display = value ? new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value.format("YYYY-MM-DD")}T00:00:00Z`)) : locale === "pt" ? "Selecionar data" : "Choose date";

  return <div className="birth-date-field">
    <label id={`${id}-label`}>{label}</label>
    <input type="hidden" name={name} value={value?.format("YYYY-MM-DD") ?? ""}/>
    <button type="button" className="birth-date-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-required="true" onClick={() => { setView("day"); setOpen(current => !current); }}><span id={`${id}-value`}>{display}</span><PortalIcon name="calendar" size={19}/></button>
    {help && <span className="field-help">{help}</span>}
    {open && <div className="birth-date-popover" role="dialog" aria-modal="false" aria-label={label}>
      <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={locale === "pt" ? "pt" : "en-gb"} localeText={localeText}>
        <DateCalendar value={value} onChange={(nextValue, selectionState, selectedView) => {
          setValue(nextValue);
          if (selectedView === "day" && selectionState === "finish") setView("year");
          if (view === "year") setOpen(false);
        }} view={view} onViewChange={nextView => { if (nextView === "day" || nextView === "year") setView(nextView); }} minDate={minDate ? dayjs(minDate) : undefined} maxDate={maxDate ? dayjs(maxDate) : dayjs().startOf("day")} referenceDate={initial?.isValid() ? initial : minDate ? dayjs(minDate) : dayjs()} views={["day", "year"]}/>
      </LocalizationProvider>
      <button type="button" className="text-button birth-date-close" onClick={() => setOpen(false)}>{locale === "pt" ? "Fechar" : "Close"}</button>
    </div>}
  </div>;
}
