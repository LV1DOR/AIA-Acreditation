export const locales = ["pt", "en"] as const;
export type Locale = typeof locales[number];
export function isLocale(value: string): value is Locale { return value === "pt" || value === "en"; }
export { messages } from "./messages.ts";
