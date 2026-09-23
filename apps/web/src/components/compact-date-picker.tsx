"use client";

import { createContext, useContext, useEffect, useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
const PickerContext = createContext<{ openId: string | null; setOpenId: Dispatch<SetStateAction<string | null>> } | null>(null);

export function CompactDatePickerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return <PickerContext.Provider value={{ openId, setOpenId }}>{children}</PickerContext.Provider>;
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
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [value, setValue] = useState<Dayjs | null>(() => initialValue(defaultValue, kind));
  useEffect(() => setHydrated(true), []);

  const open = coordinator.openId === id;
  const serialized = value ? kind === "date" ? value.format("YYYY-MM-DD") : value.toISOString() : "";
  const localeText = locale === "pt" ? ptPT.components.MuiLocalizationProvider.defaultProps.localeText : undefined;
  const common = {
    disabled: !hydrated,
    label,
    onChange: setValue,
    onClose: () => coordinator.setOpenId(current => current === id ? null : current),
    onOpen: () => coordinator.setOpenId(id),
    open,
    slotProps: {
      textField: { fullWidth: true, required: true, size: "small" as const },
      popper: { placement: "bottom-start" as const },
    },
    value,
  };

  return <div className="compact-picker-field" data-hydrated={hydrated ? "true" : "false"}>
    <input type="hidden" name={name} value={serialized}/>
    <LocalizationProvider
      dateAdapter={AdapterDayjs}
      adapterLocale={locale === "pt" ? "pt" : "en-gb"}
      localeText={localeText}
    >
      {kind === "datetime"
        ? <DateTimePicker
            {...common}
            ampm={false}
            minutesStep={5}
            timezone={eventTimezone}
            viewRenderers={{ hours: renderTimeViewClock, minutes: renderTimeViewClock, seconds: null }}
          />
        : <DatePicker {...common} closeOnSelect format="DD MMM YYYY"/>}
    </LocalizationProvider>
  </div>;
}
