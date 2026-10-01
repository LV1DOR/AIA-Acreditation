"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkAllNotificationsRead({ label, disabled = false, onMarked }: { label: string; disabled?: boolean; onMarked?: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function markAll() {
    if (pending || disabled) return;
    setPending(true);
    try {
      const response = await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (response.ok) {
        onMarked?.();
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return <button type="button" className="notification-mark-all" disabled={disabled || pending} onClick={markAll}>{label}</button>;
}
