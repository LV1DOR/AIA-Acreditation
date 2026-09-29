"use client";
import { useState } from "react";
import { PortalIcon } from "./portal-icon.tsx";

export function NotificationMenu({ unread: initialUnread, label, empty, items }: { unread: number; label: string; empty: string; items: Array<{ id: string; text: string }> }) {
  const [unread, setUnread] = useState(initialUnread);
  async function opened(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || unread === 0) return;
    const response = await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (response.ok) setUnread(0);
  }
  return <details className="notification-menu" onToggle={opened}><summary aria-label={label}><PortalIcon name="bell"/><span className="counter">{unread}</span></summary><div className="notification-popover">{items.length ? items.map(item => <p key={item.id}>{item.text}</p>) : <p>{empty}</p>}</div></details>;
}
