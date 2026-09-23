import { defineRouting } from "next-intl/routing";
import { locales } from "@aia/i18n";
export const routing = defineRouting({ locales, defaultLocale: "pt", localePrefix: "always", localeDetection: false });

