"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PortalIcon } from "./portal-icon.tsx";

type Field = { name: string; value: string };

export function IrreversibleDeleteButton({
  action, fields, trigger, title, description, cancel, confirm, compact = false,
}: {
  action: (data: FormData) => void | Promise<void>;
  fields: Field[];
  trigger: string;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>{setHydrated(true);},[]);
  const dialog = open ? <div className="portal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setOpen(false); }}>
    <section className="portal-modal irreversible-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`delete-${fields.map(field => field.value).join("-")}`}>
      <header><span className="irreversible-dialog-icon"><PortalIcon name="alert"/></span><div><h2 id={`delete-${fields.map(field => field.value).join("-")}`}>{title}</h2><p>{description}</p></div><button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label={cancel}>×</button></header>
      <div className="irreversible-warning"><PortalIcon name="alert"/><strong>{confirm}</strong></div>
      <footer><button className="button secondary" type="button" onClick={() => setOpen(false)}>{cancel}</button><form action={action}>{fields.map(field => <input key={field.name} type="hidden" name={field.name} value={field.value}/>)}<button className="button danger" type="submit">{confirm}</button></form></footer>
    </section>
  </div> : null;
  return <>
    <button className={compact ? "ops-delete-trigger" : "button danger-outline"} type="button" disabled={!hydrated} data-hydrated={hydrated} onClick={() => setOpen(true)}>{trigger}</button>
    {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
  </>;
}
