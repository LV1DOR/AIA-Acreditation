"use client";

import { useState } from "react";

export function ParticipantAvatar({ name, photoUrl, size = "medium" }: { name: string | null; photoUrl?: string; size?: "small" | "medium" | "large" }) {
  const [failed, setFailed] = useState(false);
  const fallback = name?.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "—";
  return <span className={`participant-avatar avatar-${size}`} aria-hidden="true">
    {photoUrl && !failed ? <img src={photoUrl} alt="" onError={() => setFailed(true)}/> : fallback}
  </span>;
}
