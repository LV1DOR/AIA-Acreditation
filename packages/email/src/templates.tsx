import { render } from "@react-email/render";
import React from "react";
import { z } from "zod";
import { EmailAction, EmailLayout, emailStyles as styles } from "./layout.tsx";

export const businessEmailTemplate = z.enum([
  "VEHICLE_PASS_APPROVED", "VEHICLE_PASS_REJECTED", "ACCESS_REMOVED", "ACCESS_RESTORED", "PRIMARY_LEADER_CHANGED", "REGISTRATION_CONFIGURATION", "APPROVAL_INVALIDATED",
  "STATUS_UPDATE", "SUBMISSION_RECEIVED", "SUBMISSION_APPROVED", "SUBMISSION_RETURNED", "SUBMISSION_REJECTED",
  "REQUEST_SUBMITTED", "REQUEST_APPROVED", "REQUEST_REJECTED", "URGENT_SUBSTITUTION", "DEADLINE_REMINDER",
]);
export type BusinessEmailTemplate = z.infer<typeof businessEmailTemplate>;

export const businessEmailData = z.object({
  companyName: z.string().trim().min(1).max(200),
  eventName: z.string().trim().min(1).max(200),
  appUrl: z.url(),
  reason: z.string().trim().max(4000).optional(),
  deadline: z.string().trim().max(100).optional(),
}).strict();
export type BusinessEmailData = z.infer<typeof businessEmailData>;

const copy: Record<BusinessEmailTemplate, { subject: string; pt: string; en: string; actionPt: string; actionEn: string }> = {
  VEHICLE_PASS_APPROVED:{subject:"Passes de veículo aprovados / Vehicle passes approved",pt:"A AIA aprovou os passes de veículo desta inscrição.",en:"AIA approved the vehicle passes for this registration.",actionPt:"Ver decisão",actionEn:"View decision"},
  VEHICLE_PASS_REJECTED:{subject:"Passes de veículo não aprovados / Vehicle passes not approved",pt:"A AIA não aprovou os passes de veículo desta inscrição. Consulte a decisão e o motivo no portal.",en:"AIA did not approve the vehicle passes for this registration. Review the decision and reason in the portal.",actionPt:"Ver decisão",actionEn:"View decision"},
  ACCESS_REMOVED:{subject:"Acesso da empresa alterado / Company access changed",pt:"O seu acesso de responsável foi removido. Contacte a AIA se precisar de esclarecimentos.",en:"Your company leader access was removed. Contact AIA if you need clarification.",actionPt:"Abrir portal",actionEn:"Open portal"},
  ACCESS_RESTORED:{subject:"Acesso da empresa reposto / Company access restored",pt:"O seu acesso de responsável foi reposto.",en:"Your company leader access was restored.",actionPt:"Abrir portal",actionEn:"Open portal"},
  PRIMARY_LEADER_CHANGED:{subject:"Responsável da inscrição atualizado / Registration leader updated",pt:"Foi definido como responsável principal desta inscrição.",en:"You have been assigned as this registration's primary company leader.",actionPt:"Abrir inscrição",actionEn:"Open registration"},
  REGISTRATION_CONFIGURATION:{subject:"Configuração da inscrição atualizada / Registration configuration updated",pt:"A AIA atualizou a configuração da inscrição. Consulte as alterações no portal.",en:"AIA updated the registration configuration. Review the changes in the portal.",actionPt:"Ver alterações",actionEn:"View changes"},
  APPROVAL_INVALIDATED:{subject:"Nova revisão necessária / New review required",pt:"A inscrição foi alterada e necessita de nova revisão. Consulte os próximos passos no portal.",en:"The registration changed and needs a new review. Check the next steps in the portal.",actionPt:"Rever inscrição",actionEn:"Review registration"},
  STATUS_UPDATE:{subject:"Atualização do portal / Portal update",pt:"Consulte no portal o estado atual desta inscrição.",en:"Open the portal to review the current registration status.",actionPt:"Abrir portal",actionEn:"Open portal"},
  SUBMISSION_RECEIVED: { subject: "Submissão recebida / Submission received", pt: "Recebemos a submissão final. A equipa AIA irá agora analisá-la.", en: "We received the final submission. The AIA team will now review it.", actionPt: "Ver submissão", actionEn: "View submission" },
  SUBMISSION_APPROVED: { subject: "Submissão aprovada / Submission approved", pt: "A submissão final foi aprovada pela AIA.", en: "The final submission was approved by AIA.", actionPt: "Abrir portal", actionEn: "Open portal" },
  SUBMISSION_RETURNED: { subject: "Correções necessárias / Corrections required", pt: "A submissão foi devolvida para correção. Consulte no portal as ações necessárias.", en: "The submission was returned for correction. See the required actions in the portal.", actionPt: "Corrigir submissão", actionEn: "Correct submission" },
  SUBMISSION_REJECTED: { subject: "Submissão rejeitada / Submission rejected", pt: "A submissão final foi rejeitada pela AIA.", en: "The final submission was rejected by AIA.", actionPt: "Ver decisão", actionEn: "View decision" },
  REQUEST_SUBMITTED: { subject: "Pedido recebido / Request received", pt: "O pedido foi recebido e aguarda decisão da AIA.", en: "The request was received and is awaiting AIA's decision.", actionPt: "Acompanhar pedido", actionEn: "Track request" },
  REQUEST_APPROVED: { subject: "Pedido aprovado / Request approved", pt: "O pedido foi aprovado pela AIA.", en: "The request was approved by AIA.", actionPt: "Ver pedido", actionEn: "View request" },
  REQUEST_REJECTED: { subject: "Pedido rejeitado / Request rejected", pt: "O pedido foi rejeitado pela AIA.", en: "The request was rejected by AIA.", actionPt: "Ver pedido", actionEn: "View request" },
  URGENT_SUBSTITUTION: { subject: "Substituição urgente / Urgent replacement", pt: "Foi submetido um pedido urgente de substituição que requer análise.", en: "An urgent replacement request requiring review was submitted.", actionPt: "Rever pedido", actionEn: "Review request" },
  DEADLINE_REMINDER: { subject: "Prazo de acreditação / Accreditation deadline", pt: "O prazo de submissão aproxima-se. Confirme que os dados estão completos.", en: "The submission deadline is approaching. Please confirm that all details are complete.", actionPt: "Continuar preparação", actionEn: "Continue preparation" },
};

function AiaEmail({ template, data }: { template: BusinessEmailTemplate; data: BusinessEmailData }) {
  const text = copy[template];
  const [titlePt, titleEn] = text.subject.split(" / ");
  return <EmailLayout preview={`${text.subject} — ${data.eventName}`}>
    <p style={styles.label}>PORTAL AIA · {data.eventName}</p>
    <h1 style={styles.heading}>{titlePt}<br/><span lang="en" style={{ fontSize: "20px", fontWeight: 400, color: "#68717d" }}>{titleEn}</span></h1>
    <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: "#f5f7f9", borderRadius: "6px", marginBottom: "24px" }}><tbody>
      <tr><td style={{ padding: "16px 18px 4px", ...styles.label }}>EMPRESA / COMPANY</td></tr>
      <tr><td style={{ padding: "0 18px 16px", fontSize: "16px", fontWeight: 700, color: "#161c24" }}>{data.companyName}</td></tr>
    </tbody></table>
    <p lang="pt" style={styles.paragraph}>{text.pt}</p>
    <p lang="en" style={{ ...styles.paragraph, color: "#68717d" }}>{text.en}</p>
    {data.deadline && <p style={{ ...styles.paragraph, backgroundColor: "#fff5ea", padding: "14px 18px", borderLeft: "3px solid #c88326" }}><strong>Prazo / Deadline</strong><br/>{data.deadline}</p>}
    {data.reason && <div style={{ backgroundColor: "#fff1f3", borderLeft: "3px solid #cf1535", padding: "16px 18px", marginTop: "20px" }}><p style={styles.label}>NOTA DA AIA / AIA NOTE</p><p style={{ ...styles.paragraph, whiteSpace: "pre-wrap", margin: 0 }}>{data.reason}</p></div>}
    <EmailAction url={data.appUrl} label={`${text.actionPt} · ${text.actionEn}`}/>
    <p style={styles.small}>Consulte os detalhes e os próximos passos no portal.<br/><span lang="en">Review the details and next steps in the portal.</span></p>
  </EmailLayout>;
}

export async function renderBusinessEmail(templateInput: BusinessEmailTemplate, dataInput: BusinessEmailData) {
  const template = businessEmailTemplate.parse(templateInput), data = businessEmailData.parse(dataInput);
  const element = <AiaEmail template={template} data={data}/>;
  return { subject: `${copy[template].subject} — ${data.eventName}`, html: await render(element), text: await render(element, { plainText: true }) };
}

