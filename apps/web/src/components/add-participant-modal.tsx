"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { createParticipantAction, createParticipantLinkAction } from "../app/[locale]/company/[registrationId]/actions.ts";
import { PortalIcon } from "./portal-icon.tsx";

const copy = {
  pt: {
    open: "Adicionar pessoa", title: "Adicionar trabalhador", intro: "Escolha como pretende adicionar esta pessoa ao evento.",
    manual: "Preencher dados manualmente", manualHelp: "Introduza agora os dados do trabalhador.",
    share: "Partilhar ligação segura", shareHelp: "Crie uma ligação única para o trabalhador preencher os próprios dados.",
    linkTitle: "Ligação pronta para partilhar", linkHelp: "Envie esta ligação diretamente ao trabalhador. Só pode ser utilizada uma vez.",
    generate: "Criar ligação", generating: "A criar…", copy: "Copiar ligação", copied: "Copiada!", close: "Fechar", closeDialog: "Fechar janela", cancel: "Cancelar", error: "Não foi possível criar a ligação.",
  },
  en: {
    open: "Add person", title: "Add worker", intro: "Choose how you want to add this person to the event.",
    manual: "Fill in details manually", manualHelp: "Enter the worker details now.",
    share: "Share a secure link", shareHelp: "Create a one-time link so the worker can complete their own details.",
    linkTitle: "Link ready to share", linkHelp: "Send this link directly to the worker. It can only be used once.",
    generate: "Create link", generating: "Creating…", copy: "Copy link", copied: "Copied!", close: "Close", closeDialog: "Close dialog", cancel: "Cancel", error: "The link could not be created.",
  },
} as const;

type AddParticipantModalProps = { locale: "pt" | "en"; registrationId: string; disabled: boolean; employeeLinks?: boolean };

export function AddParticipantModal({ locale, registrationId, disabled, employeeLinks = true }: AddParticipantModalProps) {
  const labels = copy[locale];
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  return <>
    <button className="button primary" type="button" disabled={disabled} onClick={() => setOpen(true)}><PortalIcon name="people"/>{labels.open}</button>
    {open && <AddParticipantDialog locale={locale} registrationId={registrationId} employeeLinks={employeeLinks} onDismiss={dismiss}/>}
  </>;
}

function AddParticipantDialog({ locale, registrationId, employeeLinks = true, onDismiss }: Omit<AddParticipantModalProps, "disabled"> & { onDismiss: () => void }) {
  const labels = copy[locale];
  const [mode, setMode] = useState<"choose" | "share">("choose");
  const [state, action, pending] = useActionState(createParticipantLinkAction, {});
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onDismiss]);
  function dismiss() { onDismiss(); }
  async function copyLink() {
    if (!state.link) return;
    await navigator.clipboard.writeText(state.link);
    setCopied(true);
  }
  return <div className="portal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) dismiss(); }}>
      <section className="portal-modal add-worker-modal" role="dialog" aria-modal="true" aria-labelledby="add-worker-title">
        <header><div><h2 id="add-worker-title">{mode === "share" && state.link ? labels.linkTitle : labels.title}</h2><p>{mode === "share" && state.link ? labels.linkHelp : labels.intro}</p></div><button className="modal-close" type="button" onClick={dismiss} aria-label={labels.closeDialog}>×</button></header>
        {state.link ? <div className="share-link-panel">
          <div className="share-link-input"><input value={state.link} readOnly aria-label={labels.linkTitle}/><button type="button" onClick={() => void copyLink()} aria-label={labels.copy} title={copied ? labels.copied : labels.copy}>{copied ? <PortalIcon name="check"/> : <CopyIcon/>}</button></div>
          <p className={copied ? "copy-feedback visible" : "copy-feedback"} aria-live="polite">{copied ? labels.copied : labels.copy}</p>
        </div> : <div className="add-worker-options">
          <form action={createParticipantAction}>
            <input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/>
            <button className="worker-choice" type="submit"><span className="choice-icon"><PortalIcon name="document"/></span><strong>{labels.manual}</strong><small>{labels.manualHelp}</small><span className="choice-arrow">→</span></button>
          </form>
          <form action={action}>
            <input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/>
            <button className={`worker-choice ${mode === "share" ? "selected" : ""}`} type="submit" disabled={pending || !employeeLinks} onClick={() => setMode("share")}><span className="choice-icon"><LinkIcon/></span><strong>{pending ? labels.generating : labels.share}</strong><small>{employeeLinks?labels.shareHelp:(locale==="pt"?"Após o prazo, complete os dados manualmente.":"After the deadline, complete details manually.")}</small><span className="choice-arrow">→</span></button>
          </form>
        </div>}
        {state.error && <p className="flash error">{labels.error}</p>}
        <footer><button className="button secondary" type="button" onClick={dismiss}>{state.link ? labels.close : labels.cancel}</button></footer>
      </section>
    </div>;
}

function LinkIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/></svg>; }
function CopyIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg>; }
