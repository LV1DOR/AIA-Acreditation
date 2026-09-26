"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "@aia/i18n";
import { ParticipantAvatar } from "./participant-avatar.tsx";
import { PortalIcon } from "./portal-icon.tsx";
import { AdminPhotoAdjustmentModal } from "./admin-photo-adjustment-modal.tsx";

export type AdminReviewParticipant = {
  id:string; fullName:string|null; dateOfBirth:string|null; documentType:string|null; documentNumber:string|null;
  documentExpiryDate:string|null; mobileE164:string|null; nationalityCode:string|null; photoObjectKey:string|null;
  privacyAcknowledgedAt:string|null; jobRole:{name:string}|null; workDays:string[];
};

export function AdminParticipantReviewModal({ locale, submissionId, person, reviewable }:{ locale:Locale; submissionId:string; person:AdminReviewParticipant; reviewable:boolean }) {
  const [open,setOpen]=useState(false);
  const date=new Intl.DateTimeFormat(locale === "pt" ? "pt-PT":"en-GB",{dateStyle:"medium",timeZone:"UTC"});
  const label=locale === "pt" ? { open:"Ver detalhes", title:"Dados da pessoa", close:"Fechar", personal:"Dados pessoais", identity:"Documento", work:"Dados de trabalho", birth:"Data de nascimento", phone:"Telemóvel", nationality:"Nacionalidade", type:"Tipo", number:"Número completo", expiry:"Validade", role:"Função", days:"Dias de trabalho", privacy:"Privacidade reconhecida", yes:"Sim", no:"Não", photo:"Ajustar fotografia" } : { open:"View details", title:"Person details", close:"Close", personal:"Personal details", identity:"Identity document", work:"Work details", birth:"Date of birth", phone:"Mobile", nationality:"Nationality", type:"Type", number:"Full number", expiry:"Expiry", role:"Role", days:"Work days", privacy:"Privacy acknowledged", yes:"Yes", no:"No", photo:"Adjust photo" };
  const fmt=(value:string|null)=>value ? date.format(new Date(value)) : "—";
  const photoUrl=person.photoObjectKey ? `/api/admin/submissions/${submissionId}/participants/${person.id}/photo` : undefined;
  return <><button className="admin-person-trigger" type="button" onClick={()=>setOpen(true)}><ParticipantAvatar name={person.fullName ?? "—"} photoUrl={photoUrl} size="large"/><span><strong>{person.fullName ?? "—"}</strong><small>{person.jobRole?.name ?? "—"}</small></span><span>{person.workDays.length}</span><PortalIcon name="arrow"/></button>{open && <div className="portal-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)setOpen(false);}}><section className="portal-modal admin-person-modal" role="dialog" aria-modal="true" aria-labelledby={`admin-person-${person.id}`}><header><ParticipantAvatar name={person.fullName ?? "—"} photoUrl={photoUrl} size="large"/><div><p className="section-kicker">AIA / REVIEW</p><h2 id={`admin-person-${person.id}`}>{person.fullName ?? label.title}</h2></div><button className="modal-close" type="button" onClick={()=>setOpen(false)} aria-label={label.close}>×</button></header><div className="admin-person-sections"><ReviewSection title={label.personal} icon="people"><Fact label={label.birth} value={fmt(person.dateOfBirth)}/><Fact label={label.phone} value={person.mobileE164}/><Fact label={label.nationality} value={person.nationalityCode}/></ReviewSection><ReviewSection title={label.identity} icon="id"><Fact label={label.type} value={person.documentType}/><Fact label={label.number} value={person.documentNumber}/><Fact label={label.expiry} value={fmt(person.documentExpiryDate)}/></ReviewSection><ReviewSection title={label.work} icon="briefcase"><Fact label={label.role} value={person.jobRole?.name}/><Fact label={label.days} value={person.workDays.map(value=>fmt(value)).join(" · ")}/><Fact label={label.privacy} value={person.privacyAcknowledgedAt ? label.yes:label.no}/></ReviewSection></div>{reviewable && person.photoObjectKey && <div className="admin-person-photo-action"><span>{label.photo}</span><AdminPhotoAdjustmentModal locale={locale} submissionId={submissionId} participantId={person.id} name={person.fullName ?? "—"}/></div>}<footer><button className="button secondary" type="button" onClick={()=>setOpen(false)}>{label.close}</button></footer></section></div>}</>;
}

function ReviewSection({title,icon,children}:{title:string;icon:"people"|"id"|"briefcase";children:ReactNode}) { return <section><h3><PortalIcon name={icon} size={18}/>{title}</h3><dl>{children}</dl></section>; }
function Fact({label,value}:{label:string;value:string|null|undefined}) { return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>; }
