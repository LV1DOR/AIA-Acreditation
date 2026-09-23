"use client";

import { useState, type ReactNode } from "react";

export function DeferredDetails({ children, summary }: { children: ReactNode; summary: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details open={open}>
    <summary onClick={event => { event.preventDefault(); setOpen(current => !current); }}>{summary}</summary>
    {open ? children : null}
  </details>;
}
