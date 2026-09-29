"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PortalRealtime() {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource("/api/realtime");
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener("invalidate", () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; router.refresh(); }, 250);
    });
    return () => { if (timer) clearTimeout(timer); source.close(); };
  }, [router]);
  return null;
}
