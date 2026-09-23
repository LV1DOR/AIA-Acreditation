import { PortalIcon } from "./portal-icon.tsx";

export function LeaderEventHero({ name, startDate, endDate, locale }: { name: string; startDate: Date; endDate: Date; locale: "pt" | "en" }) {
  const date = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", day: "2-digit", month: "short", year: "numeric" }).format(value);
  return <section className="leader-event-hero">
    <div className="event-hero-content"><p>EVENTO / EVENT</p><h1>{name}</h1><div className="event-meta">
      <span><PortalIcon name="calendar"/>{date(startDate)} – {date(endDate)}</span>
      <span><PortalIcon name="pin"/><span><strong>Autódromo Internacional do Algarve</strong><small>Portimão, Portugal</small></span></span>
    </div></div>
    <div className="event-hero-track" aria-hidden="true"><i/><i/><i/></div>
    <div className="event-motto">PEOPLE<br/>PASSION<br/>A SAFER EVENT<br/>TOGETHER<span/></div>
  </section>;
}
