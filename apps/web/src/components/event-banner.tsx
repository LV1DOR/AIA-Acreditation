import type { CSSProperties, ReactNode } from "react";
export function EventBanner({ eventId, name, hasImage, label, children, action }: {
  eventId: string; name: string; hasImage: boolean; label: string; children: ReactNode; action?: ReactNode;
}) {
  return <section className="ops-event-banner" style={hasImage ? { "--event-banner-image": `url('/api/events/${eventId}/banner')` } as CSSProperties : undefined}>
    <div><p>{label}</p><h2>{name}</h2><div className="ops-event-meta">{children}</div></div>{action}
  </section>;
}
