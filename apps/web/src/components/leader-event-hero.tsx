import { PortalIcon } from "./portal-icon.tsx";
import { EventBanner } from "./event-banner.tsx";
export function LeaderEventHero({ event, locale }: { event: { id: string; name: string; startDate: Date; endDate: Date; onboardingClosesAt: Date; timezone: string; bannerObjectKey: string | null }; locale: "pt" | "en" }) {
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: event.timezone, day: "2-digit", month: "short", year: "numeric" }).format(value);
  const deadline = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: event.timezone, dateStyle: "medium", timeStyle: "short" }).format(event.onboardingClosesAt);
  return <EventBanner eventId={event.id} name={event.name} hasImage={Boolean(event.bannerObjectKey)} label={locale === "pt" ? "EVENTO" : "EVENT"}>
    <span><PortalIcon name="calendar" size={17}/>{date(event.startDate)} – {date(event.endDate)}</span>
    <span><PortalIcon name="clock" size={17}/>{locale === "pt" ? "Prazo" : "Deadline"}: {deadline}</span>
  </EventBanner>;
}
