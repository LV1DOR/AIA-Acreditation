import React from "react";
import { render } from "@react-email/render";

export const logoContentId = "aia-brand-logo@joinaia.pt";
export const emailStyles = {
  paragraph: { fontSize: "15px", lineHeight: "25px", margin: "0 0 18px", color: "#343b45" },
  label: { color: "#68717d", fontSize: "11px", letterSpacing: "1px", fontWeight: 700, margin: "0 0 8px" },
  heading: { fontSize: "28px", lineHeight: "35px", letterSpacing: "-0.6px", margin: "0 0 22px", color: "#161c24" },
  button: { backgroundColor: "#cf1535", border: "1px solid #cf1535", borderRadius: "6px", color: "#ffffff", display: "inline-block", fontSize: "15px", fontWeight: 700, lineHeight: "22px", padding: "15px 24px", textDecoration: "none" },
  small: { color: "#68717d", fontSize: "12px", lineHeight: "20px", margin: "14px 0 0" },
} as const;

export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return <html lang="pt"><head><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="color-scheme" content="light"/></head>
    <body style={{ margin: 0, padding: "28px 12px", backgroundColor: "#f1f3f5", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{preview}</div>
      <table data-aia-email="branded-v1" role="presentation" width="100%" cellPadding="0" cellSpacing="0"><tbody><tr><td align="center">
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ maxWidth: "620px", backgroundColor: "#ffffff", border: "1px solid #e1e5e9", borderRadius: "12px", overflow: "hidden" }}><tbody>
          <tr><td style={{ height: "5px", backgroundColor: "#cf1535", fontSize: "1px", lineHeight: "5px" }}>&nbsp;</td></tr>
          <tr><td style={{ padding: "28px 28px 24px", borderBottom: "1px solid #edf0f2", backgroundColor: "#ffffff" }}>
            <img src={`cid:${logoContentId}`} alt="Autódromo Internacional do Algarve" width="230" height="82" style={{ display: "block", width: "230px", maxWidth: "100%", height: "auto", border: 0 }}/>
            <p style={{ ...emailStyles.label, margin: "16px 0 0", color: "#4f5966" }}>ACREDITAÇÃO · ACCREDITATION</p>
          </td></tr>
          <tr><td style={{ padding: "30px 28px 32px" }}>{children}</td></tr>
          <tr><td style={{ padding: "22px 28px", backgroundColor: "#f8f9fa", borderTop: "1px solid #e8ebef" }}>
            <p style={{ fontSize: "12px", lineHeight: "20px", color: "#606a77", margin: 0 }}><strong>Autódromo Internacional do Algarve</strong><br/>Portal de acreditação · Accreditation portal</p>
            <p style={{ fontSize: "11px", lineHeight: "18px", color: "#737d89", margin: "12px 0 0" }}>Mantenha as suas ligações de acesso privadas. Não envie documentos de identificação por email.<br/><span lang="en">Keep your access links private. Do not send identity documents by email.</span></p>
          </td></tr>
        </tbody></table>
      </td></tr></tbody></table>
    </body></html>;
}

export function EmailAction({ url, label }: { url: string; label: string }) {
  return <><table role="presentation" cellPadding="0" cellSpacing="0" style={{ marginTop: "26px" }}><tbody><tr><td><a href={url} style={emailStyles.button}>{label}</a></td></tr></tbody></table>
    <p style={emailStyles.small}>Se o botão não funcionar, copie a ligação abaixo.<br/><span lang="en">If the button does not work, copy the link below.</span><br/>
      <a href={url} style={{ color: "#a9142e", wordBreak: "break-all" }}>{url}</a></p></>;
}

/** Wrap existing trusted application/provider HTML without changing codes or links. */
export async function brandEmailHtml(html: string, subject: string) {
  if (html.includes('data-aia-email="branded-v1"')) return html;
  // Provider HTML is already accepted only after signature verification. This is
  // document extraction, not a sanitizer: do not use this API on untrusted HTML.
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1]
    ?? html.replace(/<!doctype[^>]*>/gi, "").replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "").replace(/<\/?html\b[^>]*>/gi, "");
  return render(<EmailLayout preview={subject}><h1 style={emailStyles.heading}>{subject}</h1><div dangerouslySetInnerHTML={{ __html: body }}/></EmailLayout>);
}
