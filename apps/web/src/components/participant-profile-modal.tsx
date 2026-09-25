"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleFlag } from "react-circle-flags";
import { approveParticipantFromTeamAction, removeParticipantAction } from "../app/[locale]/company/[registrationId]/actions.ts";
import { ParticipantAvatar } from "./participant-avatar.tsx";
import { PortalIcon } from "./portal-icon.tsx";

export type ParticipantProfile = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  documentLast3: string | null;
  dateOfBirth: string | null;
  documentType: string | null;
  documentExpiry: string | null;
  mobile: string | null;
  nationalityCode: string | null;
  nationality: string | null;
  jobRole: string | null;
  workDays: string[];
  privacyAcknowledged: boolean;
  photoUrl?: string;
};

const copy = {
  pt: {
    profile: "Perfil da pessoa", open: "Ver perfil", personal: "Dados pessoais", birth: "Data de nascimento", mobile: "Telemóvel",
    nationality: "Nacionalidade", identification: "Identificação", documentType: "Tipo de documento", document: "Documento",
    expiry: "Validade", work: "Dados de trabalho", role: "Função", days: "Dias de trabalho", privacy: "Privacidade reconhecida",
    yes: "Sim", no: "Não", unavailable: "Por preencher", edit: "Editar dados", approve: "Aprovar pessoa", remove: "Remover pessoa",
    removeTitle: "Remover esta pessoa?", removeHelp: "A pessoa deixa de contar para o limite da equipa. O histórico fica preservado.",
    confirmRemove: "Sim, remover", keep: "Manter pessoa", close: "Fechar", closeDialog: "Fechar janela", ending: "Terminado em",
  },
  en: {
    profile: "Person profile", open: "View profile", personal: "Personal details", birth: "Date of birth", mobile: "Mobile number",
    nationality: "Nationality", identification: "Identification", documentType: "Document type", document: "Document",
    expiry: "Expiry date", work: "Work details", role: "Job role", days: "Working days", privacy: "Privacy acknowledged",
    yes: "Yes", no: "No", unavailable: "Not provided", edit: "Edit details", approve: "Approve person", remove: "Remove person",
    removeTitle: "Remove this person?", removeHelp: "They will no longer count towards the team limit. Their audit history will be preserved.",
    confirmRemove: "Yes, remove", keep: "Keep person", close: "Close", closeDialog: "Close dialog", ending: "Ending in",
  },
} as const;

export function ParticipantProfileModal({ locale, registrationId, participant, editable, variant = "team", issueLabel }: {
  locale: "pt" | "en";
  registrationId: string;
  participant: ParticipantProfile;
  editable: boolean;
  variant?: "team" | "action" | "summary";
  issueLabel?: string;
}) {
  const labels = copy[locale];
  const [open, setOpen] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setConfirmingRemoval(false); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  function dismiss() { setOpen(false); setConfirmingRemoval(false); }

  const trigger = variant === "action"
    ? <button type="button" className="action-row profile-action-row" onClick={() => setOpen(true)} aria-label={`${labels.open}: ${participant.name}`}>
        <ParticipantAvatar name={participant.name} photoUrl={participant.photoUrl}/><strong>{participant.name}</strong><span><i className={participant.status === "DUPLICATE_REVIEW_REQUIRED" ? "red" : "amber"}><PortalIcon name="alert" size={18}/></i>{issueLabel}</span><PortalIcon name="arrow"/>
      </button>
    : <button type="button" className={`participant-profile-trigger profile-${variant}`} onClick={() => setOpen(true)} aria-label={`${labels.open}: ${participant.name}`}>
        <ParticipantAvatar name={participant.name} photoUrl={participant.photoUrl}/><span><strong>{participant.name}</strong><small>{participant.documentLast3 ? `${labels.document} ${labels.ending.toLowerCase()} •••${participant.documentLast3}` : labels.unavailable}</small></span>
      </button>;

  return <>{trigger}{open && <div className="portal-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) dismiss(); }}>
    <section className="portal-modal participant-profile-modal" role="dialog" aria-modal="true" aria-labelledby={`participant-profile-${participant.id}`}>
      <header className="profile-modal-header"><ParticipantAvatar name={participant.name} photoUrl={participant.photoUrl} size="large"/><div><p className="section-kicker">{labels.profile}</p><h2 id={`participant-profile-${participant.id}`}>{participant.name}</h2><span className={`participant-status status-${participant.status.toLowerCase()}`}>{participant.statusLabel}</span></div><button className="modal-close" type="button" onClick={dismiss} aria-label={labels.closeDialog}>×</button></header>
      <div className="profile-detail-sections">
        <ProfileSection title={labels.personal} icon="people"><Fact label={labels.birth} value={participant.dateOfBirth}/><Fact label={labels.mobile} value={participant.mobile}/><Fact label={labels.nationality} value={participant.nationality} flag={participant.nationalityCode}/></ProfileSection>
        <ProfileSection title={labels.identification} icon="id"><Fact label={labels.documentType} value={participant.documentType}/><Fact label={labels.document} value={participant.documentLast3 ? `•••${participant.documentLast3}` : null}/><Fact label={labels.expiry} value={participant.documentExpiry}/></ProfileSection>
        <ProfileSection title={labels.work} icon="briefcase"><Fact label={labels.role} value={participant.jobRole}/><Fact label={labels.days} value={participant.workDays.length ? participant.workDays.join(" · ") : null}/><Fact label={labels.privacy} value={participant.privacyAcknowledged ? labels.yes : labels.no}/></ProfileSection>
      </div>
      {confirmingRemoval && <div className="profile-remove-confirm" role="alert"><PortalIcon name="alert"/><div><strong>{labels.removeTitle}</strong><p>{labels.removeHelp}</p></div><button className="button secondary" type="button" onClick={() => setConfirmingRemoval(false)}>{labels.keep}</button><form action={removeParticipantAction}><ActionFields locale={locale} registrationId={registrationId} participantId={participant.id}/><button className="button danger" type="submit">{labels.confirmRemove}</button></form></div>}
      <footer><button className="button secondary" type="button" onClick={dismiss}>{labels.close}</button>{editable && !confirmingRemoval && <><button className="button danger-outline" type="button" onClick={() => setConfirmingRemoval(true)}>{labels.remove}</button><Link className="button secondary" href={`/${locale}/company/${registrationId}/participants/${participant.id}`}>{labels.edit}</Link>{participant.status === "AWAITING_LEADER_REVIEW" && <form action={approveParticipantFromTeamAction}><ActionFields locale={locale} registrationId={registrationId} participantId={participant.id}/><button className="button primary" type="submit">{labels.approve}</button></form>}</>}</footer>
    </section>
  </div>}</>;
}

function ActionFields({ locale, registrationId, participantId }: { locale: string; registrationId: string; participantId: string }) {
  return <><input type="hidden" name="locale" value={locale}/><input type="hidden" name="registrationId" value={registrationId}/><input type="hidden" name="participantId" value={participantId}/></>;
}

function ProfileSection({ title, icon, children }: { title: string; icon: "people" | "id" | "briefcase"; children: React.ReactNode }) {
  return <section><h3><span><PortalIcon name={icon} size={18}/></span>{title}</h3><dl>{children}</dl></section>;
}

function Fact({ label, value, flag }: { label: string; value: string | null; flag?: string | null }) {
  return <div><dt>{label}</dt><dd>{flag && /^[A-Z]{2}$/.test(flag) && <CircleFlag countryCode={flag.toLowerCase()} width={18} height={18}/>}<span>{value ?? "—"}</span></dd></div>;
}
