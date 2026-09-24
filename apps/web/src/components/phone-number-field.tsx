"use client";

import { useState } from "react";
import PhoneInput, { type Value } from "react-phone-number-input";

export function PhoneNumberField({ defaultValue, label, name }: { defaultValue?: string; label: string; name: string }) {
  const [value, setValue] = useState<Value | undefined>(defaultValue ? defaultValue as Value : undefined);
  return <div className="phone-number-field"><label>{label}</label><PhoneInput name={name} value={value} onChange={setValue} defaultCountry="PT" international countryCallingCodeEditable={false} placeholder="+351 912 345 678" aria-label={label} required/></div>;
}
