"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dayjs/locale/en-gb.js";
import "dayjs/locale/pt.js";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { ptPT } from "@mui/x-date-pickers/locales";
import { renderTimeViewClock } from "@mui/x-date-pickers/timeViewRenderers";
import type { Locale } from "@aia/i18n";

dayjs.extend(utc);
dayjs.extend(timezone);

const eventTimezone = "Europe/Lisbon";
type PickerCoordinator = {
  openId: string | null;
  close: (id: string) => void;
  open: (id: string) => void;
};
const PickerContext = createContext<PickerCoordinator | null>(null);

export function CompactDatePickerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback((id: string) => setOpenId(current => current === id ? null : current), []);
  const value = useMemo(() => ({ openId, open, close }), [close, open, openId]);
  return <PickerContext.Provider value={value}>{children}</PickerContext.Provider>;
}

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
  const coordinator = useContext(PickerContext);
  if (!coordinator) throw new Error("DATE_PICKER_PROVIDER_REQUIRED");
  const { close: closePicker, open: openPicker, openId } = coordinator;
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [value, setValue] = useState<Dayjs | null>(() => initialValue(defaultValue, kind));
  useEffect(() => setHydrated(true), []);

  const isOpen = openId === id;
  const serialized = value ? kind === "date" ? value.format("YYYY-MM-DD") : value.toISOString() : "";
  const localeText = locale === "pt" ? ptPT.components.MuiLocalizationProvider.defaultProps.localeText : undefined;
  const handleClose = useCallback(() => closePicker(id), [closePicker, id]);
  const handleOpen = useCallback(() => openPicker(id), [id, openPicker]);
  const handleChange = useCallback((next: Dayjs | null) => setValue(next), []);
  const slotProps = useMemo(() => ({
      textField: { fullWidth: true, required: true, size: "small" as const },
      popper: { placement: "bottom-start" as const },
    }), []);
  const timeViewRenderers = useMemo(() => ({ hours: renderTimeViewClock, minutes: renderTimeViewClock, seconds: null }), []);

  return <div className="compact-picker-field" data-hydrated={hydrated ? "true" : "false"}>
    <input type="hidden" name={name} value={serialized}/>
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale={locale === "pt" ? "pt" : "en-gb"}
      localeText={localeText}
    >
      {kind === "datetime"
        ? <DateTimePicker
            disabled={!hydrated}
            label={label}
            onChange={handleChange}
            onClose={handleClose}
            onOpen={handleOpen}
            open={isOpen}
            slotProps={slotProps}
            value={value}
            ampm={false}
            minutesStep={5}
            timezone={eventTimezone}
            viewRenderers={timeViewRenderers}
          />
        : <DatePicker disabled={!hydrated} label={label} onChange={handleChange} onClose={handleClose} onOpen={handleOpen} open={isOpen} slotProps={slotProps} value={value} closeOnSelect format="DD MMM YYYY"/>}
    </LocalizationProvider>
  </div>;
}
