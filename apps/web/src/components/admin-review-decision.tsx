"use client";

import { useState } from "react";
import type { Locale } from "@aia/i18n";
import { reviewSubmissionAction } from "../app/[locale]/admin/queue/[submissionId]/actions.ts";
import { PortalIcon } from "./portal-icon.tsx";

const copy = {
  pt: {
    title: "Decisão da AIA", intro: "Analise a submissão e tome uma decisão.", approve: "Aprovar", approveHelp: "A submissão será aprovada e a empresa será notificada.",
    return: "Devolver para correção", returnHelp: "A empresa poderá editar e voltar a submeter.", reject: "Rejeitar", rejectHelp: "A submissão será rejeitada.",
    reason: "Categoria do motivo", comment: "Comentário obrigatório para devolver ou rejeitar", placeholder: "Escreva aqui o seu comentário…", confirm: "Confirmar decisão",
    progress:"Revisão das pessoas", pending:"Por rever", approvedPeople:"Aprovadas", returnedPeople:"Para corrigir", reviewFirst:"Reveja todas as pessoas antes de concluir a submissão.",
    reasons: { ZONES: "Zonas", VEHICLE_PASS: "Passe de veículo", PERSONNEL: "Pessoas", PHOTO: "Fotografia", DOCUMENT: "Documento", WORK_DAYS: "Dias de trabalho", HEADCOUNT: "Limite de pessoas", DUPLICATE: "Possível duplicado", OTHER: "Outro" },
  },
  en: {
    title: "AIA decision", intro: "Review the submission and make a decision.", approve: "Approve", approveHelp: "The submission will be approved and the company notified.",
    return: "Return for correction", returnHelp: "The company can edit and submit again.", reject: "Reject", rejectHelp: "The submission will be rejected.",
    reason: "Reason category", comment: "Comment required for return or rejection", placeholder: "Write your comment here…", confirm: "Confirm decision",
    progress:"People review", pending:"Pending", approvedPeople:"Approved", returnedPeople:"To correct", reviewFirst:"Review every person before completing the submission.",
    reasons: { ZONES: "Zones", VEHICLE_PASS: "Vehicle pass", PERSONNEL: "People", PHOTO: "Photo", DOCUMENT: "Document", WORK_DAYS: "Work days", HEADCOUNT: "Headcount", DUPLICATE: "Possible duplicate", OTHER: "Other" },
  },
} as const;

type Decision = "APPROVE" | "RETURN" | "REJECT";

export function AdminReviewDecision({ locale, submissionId, version, approvedPeople, returnedPeople, pendingPeople }: { locale: Locale; submissionId: string; version: number; approvedPeople:number; returnedPeople:number; pendingPeople:number }) {
  const [decision, setDecision] = useState<Decision>(returnedPeople ? "RETURN":"APPROVE");
  const labels = copy[locale];
  const selectedPeopleReturn=decision === "RETURN" && returnedPeople > 0;
  const needsReason = decision !== "APPROVE" && !selectedPeopleReturn;
  const canConfirm=decision === "REJECT" || (pendingPeople === 0 && (decision !== "APPROVE" || returnedPeople === 0));
  const choices: { value: Decision; label: string; help: string }[] = [
    { value: "APPROVE", label: labels.approve, help: labels.approveHelp },
    { value: "RETURN", label: labels.return, help: labels.returnHelp },
    { value: "REJECT", label: labels.reject, help: labels.rejectHelp },
  ];
  return <aside className="admin-decision-card">
    <header><span><PortalIcon name="check"/></span><div><h2>{labels.title}</h2><p>{labels.intro}</p></div></header>
    <form action={reviewSubmissionAction} className="admin-decision-form">
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="submissionId" value={submissionId}/><input type="hidden" name="expectedRegistrationVersion" value={version}/><input type="hidden" name="decision" value={decision}/>
      <fieldset className="decision-options"><legend className="sr-only">{labels.title}</legend>{choices.map(choice => <label key={choice.value} className={decision === choice.value ? "selected" : undefined}><input type="radio" name="decisionChoice" value={choice.value} checked={decision === choice.value} onChange={() => setDecision(choice.value)}/><span className="decision-radio">{decision === choice.value && <PortalIcon name="check" size={15}/>}</span><span><strong>{choice.label}</strong><small>{choice.help}</small></span></label>)}</fieldset>
      <section className="person-review-progress"><h3>{labels.progress}</h3><div><span><b>{approvedPeople}</b>{labels.approvedPeople}</span><span><b>{returnedPeople}</b>{labels.returnedPeople}</span><span><b>{pendingPeople}</b>{labels.pending}</span></div>{pendingPeople > 0 && decision !== "REJECT" && <p><PortalIcon name="alert" size={16}/>{labels.reviewFirst}</p>}</section>
      {selectedPeopleReturn && <><input type="hidden" name="reason" value="PERSONNEL"/><input type="hidden" name="comment" value={`${returnedPeople} participant(s) returned for correction.`}/></>}
      {needsReason && <div className="decision-details"><label>{labels.reason}<select name="reason" defaultValue="OTHER" required>{Object.entries(labels.reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{labels.comment}<textarea name="comment" maxLength={500} required placeholder={labels.placeholder}/><small>0 / 500</small></label></div>}
      <button className="decision-confirm" type="submit" disabled={!canConfirm}>{labels.confirm}</button>
    </form>
  </aside>;
}
