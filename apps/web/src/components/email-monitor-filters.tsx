"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@aia/i18n";
import { emailCopy, emailStatusLabels } from "../lib/email-monitoring-copy.ts";
import { emailInvestigationCopy } from "../lib/email-investigation-copy.ts";

export function EmailMonitorFilters({ locale, query, status, eventId }: { locale: Locale; query: string; status: string; eventId?: string }) {
  const router = useRouter(), t = emailCopy[locale], c = emailInvestigationCopy[locale];
  const [search, setSearch] = useState(query), [selectedStatus, setStatus] = useState(status);
  const [pending, startTransition] = useTransition(), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function apply(q: string, nextStatus: string, delay = 0, force = false) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // An unchanged search must not reset an already-selected email page.
      const current = new URLSearchParams(window.location.search);
      if (!force && (current.get("q") ?? "").trim() === q.trim() && (current.get("status") ?? "") === nextStatus) return;
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (nextStatus) params.set("status", nextStatus);
      if (eventId) params.set("eventId", eventId);
      startTransition(() => router.replace(`/${locale}/admin/emails${params.size ? `?${params}` : ""}`, { scroll: false }));
    }, delay);
  }
  return <form className="emails-filters" role="search" aria-busy={pending} onSubmit={event => { event.preventDefault(); apply(search, selectedStatus); }}>
    <label className="emails-search">{t.search}<input name="q" type="search" value={search} maxLength={200} placeholder={c.searchHelp} onChange={event => { setSearch(event.target.value); apply(event.target.value, selectedStatus, 250); }}/></label>
    <label htmlFor="email-status"><span id="email-status-label">{t.status}</span><select id="email-status" aria-labelledby="email-status-label" name="status" value={selectedStatus} onChange={event => { setStatus(event.target.value); apply(search, event.target.value); }}><option value="">{t.allStatuses}</option>{Object.entries(emailStatusLabels[locale]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <button className="emails-text-link emails-clear" type="button" onClick={() => { setSearch(""); setStatus(""); apply("", "", 0, true); }}>{t.clear}</button>
    <span className="sr-only" role="status">{pending ? c.searching : ""}</span>
  </form>;
}
