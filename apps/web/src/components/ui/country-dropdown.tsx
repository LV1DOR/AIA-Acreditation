"use client";

import { useMemo, useState } from "react";
import { countries } from "country-data-list";
import { CircleFlag } from "react-circle-flags";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Locale } from "@aia/i18n";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

type Country = { alpha2: string; name: string; status: string };

export function CountryDropdown({ defaultValue, emptyText, label, locale, name, searchText }: { defaultValue?: string; emptyText: string; label: string; locale: Locale; name: string; searchText: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue?.toUpperCase() ?? "");
  const options = useMemo(() => {
    const names = new Intl.DisplayNames([locale === "pt" ? "pt-PT" : "en-GB"], { type: "region" });
    const unique = new Map<string, { code: string; name: string }>();
    for (const country of countries.all as Country[]) {
      if (/^[A-Z]{2}$/.test(country.alpha2) && !unique.has(country.alpha2)) unique.set(country.alpha2, { code: country.alpha2, name: names.of(country.alpha2) ?? country.name });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);
  const selected = options.find(country => country.code === value);

  return <div className="country-field">
    <label>{label}</label><input type="hidden" name={name} value={value}/>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="country-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-required="true">
        <span>{selected ? <><CircleFlag countryCode={selected.code.toLowerCase()} inline width={22} height={22}/><span>{selected.name}</span></> : <span className="muted">{emptyText}</span>}</span><ChevronsUpDown size={16}/>
      </button></PopoverTrigger>
      <PopoverContent><Command><CommandInput placeholder={searchText}/><CommandList><CommandEmpty>{emptyText}</CommandEmpty><CommandGroup>{options.map(country => <CommandItem key={country.code} value={`${country.name} ${country.code}`} onSelect={() => { setValue(country.code); setOpen(false); }}><CircleFlag countryCode={country.code.toLowerCase()} inline width={22} height={22}/><span>{country.name}</span><Check className={country.code === value ? "country-check visible" : "country-check"} size={16}/></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
    </Popover>
  </div>;
}
