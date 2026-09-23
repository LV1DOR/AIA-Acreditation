"use client";

import { useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dayjs/locale/en-gb.js";
import "dayjs/locale/pt.js";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { StaticDatePicker } from "@mui/x-date-pickers/StaticDatePicker";
import { StaticDateTimePicker } from "@mui/x-date-pickers/StaticDateTimePicker";
import { ptPT } from "@mui/x-date-pickers/locales";
import type { Locale } from "@aia/i18n";

dayjs.extend(utc);
dayjs.extend(timezone);

const eventTimezone = "Europe/Lisbon";

type Props = {
  defaultValue?: string;
  kind: "date" | "datetime";
  label: string;
  locale: Locale;
  name: string;
};

function initialValue(value: string | undefined, kind: Props["kind"]) {
  if (!value) return null;
  const parsed = kind === "datetime" ? dayjs(value).tz(eventTimezone) : dayjs(value);
  return parsed.isValid() ? parsed : null;
}

export function CompactDatePicker({ defaultValue, kind, label, locale, name }: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Dayjs | null>(() => initialValue(defaultValue, kind));

  useEffect(() => setHydrated(true), []);

  const serialized = value ? kind === "date" ? value.format("YYYY-MM-DD") : value.toISOString() : "";
  const display = value
    ? value.locale(locale === "pt" ? "pt" : "en-gb").format(kind === "date" ? "DD MMM YYYY" : "DD MMM YYYY, HH:mm")
    : locale === "pt" ? "Escolher" : "Choose";
  const localeText = locale === "pt" ? ptPT.components.MuiLocalizationProvider.defaultProps.localeText : undefined;
  const pickerSx = {
    maxWidth: "100%",
    "& .MuiPickersLayout-root": { minWidth: 0 },
    "& .MuiDateCalendar-root": { width: 300, maxWidth: "100%" },
    "& .MuiPickersToolbar-root": { padding: "12px 16px" },
  };

  return <div className="compact-picker-field">
    <span>{label}</span>
    <input type="hidden" name={name} value={serialized}/>
    <div className="compact-picker">
      <button className="picker-trigger" type="button" aria-expanded={open} disabled={!hydrated} onClick={() => setOpen(current => !current)}><span>{display}</span><span aria-hidden="true">▦</span></button>
      {open && <div className={`picker-popover ${kind === "datetime" ? "picker-wide" : ""}`}>
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale={locale === "pt" ? "pt" : "en-gb"}
          localeText={localeText}
        >
          {kind === "datetime"
            ? <StaticDateTimePicker
                ampm={false}
                minutesStep={5}
                onChange={setValue}
                orientation="landscape"
                slotProps={{ actionBar: { actions: ["accept"] } }}
                sx={pickerSx}
                timezone={eventTimezone}
                value={value}
              />
            : <StaticDatePicker
                onChange={setValue}
                orientation="landscape"
                slotProps={{ actionBar: { actions: ["accept"] } }}
                sx={pickerSx}
                value={value}
              />}
        </LocalizationProvider>
      </div>}
    </div>
  </div>;
}
