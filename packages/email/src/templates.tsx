import { render } from "@react-email/render";
import React from "react";
import { z } from "zod";

export const businessEmailTemplate = z.enum([
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
  return <html><head/><body style={styles.body}><div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>{text.subject} — {data.eventName}</div><table role="presentation" cellPadding="0" cellSpacing="0" width="100%"><tbody><tr><td align="center"><table role="presentation" cellPadding="0" cellSpacing="0" width="620" style={styles.container}><tbody><tr><td style={styles.header}><p style={styles.brand}>AIA <span style={styles.slash}>/</span></p><p style={styles.product}>ACREDITAÇÃO · ACCREDITATION</p></td></tr><tr><td style={styles.content}><p style={styles.kicker}>{data.eventName}</p><h1 style={styles.heading}>{text.subject}</h1><p style={styles.company}>{data.companyName}</p><p style={styles.paragraph}>{text.pt}</p><p style={styles.paragraph}>{text.en}</p>{data.deadline && <p style={styles.detail}><strong>Prazo / Deadline:</strong> {data.deadline}</p>}{data.reason && <div style={styles.reason}><p style={styles.reasonTitle}>Nota da AIA / AIA note</p><p style={styles.reasonText}>{data.reason}</p></div>}<a href={data.appUrl} style={styles.button}>{text.actionPt} · {text.actionEn}</a></td></tr><tr><td><hr style={styles.hr}/><p style={styles.footer}>Autódromo Internacional do Algarve · Esta mensagem não contém documentos de identificação nem fotografias. / This message contains no identity documents or photographs.</p></td></tr></tbody></table></td></tr></tbody></table></body></html>;
}

export async function renderBusinessEmail(templateInput: BusinessEmailTemplate, dataInput: BusinessEmailData) {
  const template = businessEmailTemplate.parse(templateInput), data = businessEmailData.parse(dataInput);
  const element = <AiaEmail template={template} data={data}/>;
  return { subject: `${copy[template].subject} — ${data.eventName}`, html: await render(element), text: await render(element, { plainText: true }) };
}

const styles = {
  body: { backgroundColor: "#f5f5f2", color: "#17191d", fontFamily: "Arial, sans-serif", margin: 0, padding: "28px 12px" },
  container: { backgroundColor: "#ffffff", border: "1px solid #e1e3e6", borderRadius: "10px", maxWidth: "620px", overflow: "hidden" },
  header: { backgroundColor: "#17191d", padding: "24px 30px" }, brand: { color: "#ffffff", fontSize: "30px", fontWeight: "800", margin: 0 },
  slash: { color: "#df1733" }, product: { color: "#c8cbd0", fontSize: "11px", letterSpacing: "1.4px", margin: "4px 0 0" },
  content: { padding: "30px" }, kicker: { color: "#df1733", fontSize: "12px", fontWeight: "700", letterSpacing: "1px", margin: 0 },
  heading: { fontSize: "26px", margin: "10px 0" }, company: { color: "#666d78", fontSize: "15px", margin: "0 0 24px" },
  paragraph: { fontSize: "15px", lineHeight: "24px", margin: "0 0 12px" }, detail: { fontSize: "14px", margin: "20px 0" },
  reason: { backgroundColor: "#fff1f3", borderLeft: "4px solid #df1733", padding: "12px 16px", margin: "20px 0" }, reasonTitle: { fontWeight: "700", margin: "0 0 6px" }, reasonText: { whiteSpace: "pre-wrap" as const, margin: 0 },
  button: { backgroundColor: "#df1733", borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "14px", fontWeight: "700", marginTop: "16px", padding: "13px 20px", textDecoration: "none" },
  hr: { borderColor: "#e1e3e6", margin: "0 30px" }, footer: { color: "#747b86", fontSize: "11px", lineHeight: "17px", padding: "18px 30px 24px" },
} as const;
