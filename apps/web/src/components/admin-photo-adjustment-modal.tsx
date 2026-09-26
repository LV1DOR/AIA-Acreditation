"use client";

import { useState } from "react";
import { adjustSubmissionPhotoAction } from "../app/[locale]/admin/queue/[submissionId]/actions.ts";
import { ParticipantAvatar } from "./participant-avatar.tsx";
import { SingleImageUpload } from "./single-image-upload.tsx";

const copy = {
  pt: { open: "Ajustar fotografia", title: "Ajustar fotografia para a AIA", intro: "Este enquadramento fica associado apenas a esta versão submetida. A fotografia original da empresa não é substituída.", label: "Fotografia", prompt: "Escolher fotografia", help: "Confirme o recorte quadrado antes de guardar.", cancel: "Cancelar", save: "Guardar enquadramento", close: "Fechar janela" },
  en: { open: "Adjust photo", title: "Adjust photo for AIA", intro: "This framing is attached only to this submitted version. It does not replace the company's source photo.", label: "Photo", prompt: "Choose photo", help: "Confirm the square crop before saving.", cancel: "Cancel", save: "Save framing", close: "Close dialog" },
} as const;

export function AdminPhotoAdjustmentModal({ locale, submissionId, participantId, name }: { locale: "pt" | "en"; submissionId: string; participantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const labels = copy[locale];
  const photoUrl = `/api/admin/submissions/${submissionId}/participants/${participantId}/photo`;
  return <><button className="admin-photo-trigger" type="button" onClick={() => setOpen(true)} aria-label={`${labels.open}: ${name}`}><ParticipantAvatar name={name} photoUrl={photoUrl}/><span>{labels.open}</span></button>{open && <div className="portal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setOpen(false); }}><section className="portal-modal admin-photo-modal" role="dialog" aria-modal="true" aria-labelledby={`admin-photo-${participantId}`}><header><div><h2 id={`admin-photo-${participantId}`}>{labels.title}</h2><p>{labels.intro}</p></div><button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label={labels.close}>×</button></header><form action={adjustSubmissionPhotoAction}><input type="hidden" name="locale" value={locale}/><input type="hidden" name="submissionId" value={submissionId}/><input type="hidden" name="participantId" value={participantId}/><div className="admin-photo-body"><SingleImageUpload name="photo" label={labels.label} locale={locale} prompt={labels.prompt} help={labels.help} required existingPhotoUrl={photoUrl}/></div><footer><button className="button secondary" type="button" onClick={() => setOpen(false)}>{labels.cancel}</button><button className="button primary" type="submit">{labels.save}</button></footer></form></section></div>}</>;
}
