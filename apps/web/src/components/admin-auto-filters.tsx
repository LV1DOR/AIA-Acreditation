"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

export function AdminAutoFilters({ children, clearHref, clearLabel, updatingLabel }: { children: ReactNode; clearHref: string; clearLabel: string; updatingLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function apply(form: HTMLFormElement) {
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === "string" && value.trim()) next.set(key, value.trim());
    next.delete("page"); next.delete("result");
    setUpdating(true);
    startTransition(() => { router.replace(`${pathname}?${next.toString()}`, { scroll: false }); setUpdating(false); });
  }
  function changed(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (!target.name) return;
    if (timer.current) clearTimeout(timer.current);
    if (target.type === "search") timer.current = setTimeout(() => apply(form), 300);
    else apply(form);
  }
  return <form className="ops-filters" onChange={changed} onSubmit={event => { event.preventDefault(); apply(event.currentTarget); }}>
    {children}<Link className="button secondary" href={clearHref}>{clearLabel}</Link><span className="sr-only" aria-live="polite">{updating ? updatingLabel : ""}</span>
  </form>;
}
