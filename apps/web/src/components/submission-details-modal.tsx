"use client";

import { useEffect, useState } from "react";
import { PortalIcon } from "./portal-icon.tsx";

type Summary = {
  company: string;
  event: string;
  dates: string;
  zones: string[];
  vehicle: { required: boolean; quantity: number; justification: string | null };
  participants: { id: string; name: string; role: string; status: string; days: number; documentLast3: string | null }[];
};

const copy = {
  pt: { trigger: "Ver detalhes", title: "Resumo da submissão", intro: "Confirme os dados que serão incluídos na próxima versão enviada à AIA.", event: "Evento", company: "Empresa", zones: "Zonas solicitadas", vehicle: "Pedido de veículo", workers: "Trabalhadores", none: "Nenhuma", notRequested: "Não solicitado", pass: "passe(s)", workDays: "dia(s)", close: "Fechar", closeDialog: "Fechar janela" },
  en: { trigger: "View details", title: "Submission summary", intro: "Confirm the information that will be included in the next version sent to AIA.", event: "Event", company: "Company", zones: "Requested zones", vehicle: "Vehicle request", workers: "Workers", none: "None", notRequested: "Not requested", pass: "pass(es)", workDays: "work day(s)", close: "Close", closeDialog: "Close dialog" },
} as const;

export function SubmissionDetailsModal({ locale, summary }: { locale: "pt" | "en"; summary: Summary }) {
  const [open, setOpen] = useState(false);
  const labels = copy[locale];
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return <>
    <button className="button secondary" type="button" onClick={() => setOpen(true)}>{labels.trigger}</button>
    {open && <div className="portal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setOpen(false); }}>
      <section className="portal-modal submission-details-modal" role="dialog" aria-modal="true" aria-labelledby="submission-summary-title">
        <header><div><p className="section-kicker">SUBMISSÃO / SUBMISSION</p><h2 id="submission-summary-title">{labels.title}</h2><p>{labels.intro}</p></div><button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label={labels.closeDialog}>×</button></header>
        <div className="submission-modal-overview">
          <article><span><PortalIcon name="calendar"/></span><div><small>{labels.event}</small><strong>{summary.event}</strong><p>{summary.dates}</p></div></article>
          <article><span><PortalIcon name="briefcase"/></span><div><small>{labels.company}</small><strong>{summary.company}</strong></div></article>
          <article><span><PortalIcon name="pin"/></span><div><small>{labels.zones}</small><strong>{summary.zones.length}</strong><p>{summary.zones.join(", ") || labels.none}</p></div></article>
          <article><span><PortalIcon name="car"/></span><div><small>{labels.vehicle}</small><strong>{summary.vehicle.required ? `${summary.vehicle.quantity} ${labels.pass}` : labels.notRequested}</strong>{summary.vehicle.justification && <p>{summary.vehicle.justification}</p>}</div></article>
        </div>
        <section className="submission-modal-workers"><div className="section-heading"><h3>{labels.workers}</h3><strong>{summary.participants.length}</strong></div>{summary.participants.length ? summary.participants.map(person => <article key={person.id}><span className="person-initials">{initials(person.name)}</span><div><strong>{person.name}</strong><p>{person.role} · {person.days} {labels.workDays}{person.documentLast3 ? ` · •••${person.documentLast3}` : ""}</p></div><span className="participant-status">{person.status}</span></article>) : <p>{labels.none}</p>}</section>
        <footer><button className="button secondary" type="button" onClick={() => setOpen(false)}>{labels.close}</button></footer>
      </section>
    </div>}
  </>;
}

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "—"; }
