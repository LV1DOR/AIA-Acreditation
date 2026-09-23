import { getRequestConfig } from "next-intl/server";
import { isLocale, messages } from "@aia/i18n";
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : "pt";
  return { locale, messages: messages[locale], timeZone: "Europe/Lisbon" };
});

