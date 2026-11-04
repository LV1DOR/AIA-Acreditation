"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function EmailMonitorRefresh({ label }: { label: string }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    }, 15000);
    return () => window.clearInterval(timer);
  }, [router]);
  return <button className="button secondary" type="button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>{label}</button>;
}
