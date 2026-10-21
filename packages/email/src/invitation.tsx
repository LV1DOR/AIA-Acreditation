import React from "react";
import { render } from "@react-email/render";
import { z } from "zod";
import { EmailAction, EmailLayout, emailStyles as s } from "./layout.tsx";

const inputSchema = z.object({ companyName: z.string().min(1).max(200), url: z.url(),
  locale: z.enum(["pt", "en"]), expiresAt: z.date() }).strict();

export async function renderInvitationEmail(input: z.input<typeof inputSchema>) {
  const { companyName, url, locale, expiresAt } = inputSchema.parse(input);
  const pt = locale === "pt";
  const subject = pt ? `Convite AIA — ${companyName}` : `AIA invitation — ${companyName}`;
  const expiry = new Intl.DateTimeFormat(pt ? "pt-PT" : "en-GB", {
    dateStyle: "long", timeStyle: "short", timeZone: "UTC",
  }).format(expiresAt) + " UTC";
  const html = await render(<EmailLayout preview={subject}>
    <p style={s.label}>{pt ? "ACESSO DA EMPRESA" : "COMPANY ACCESS"}</p>
    <h1 style={s.heading}>{pt ? "A sua empresa está convidada." : "Your company is invited."}</h1>
    <p style={s.paragraph}>{pt ? <>Foi convidado para gerir a acreditação de <strong>{companyName}</strong> no portal AIA.</> : <>You have been invited to manage accreditation for <strong>{companyName}</strong> in the AIA portal.</>}</p>
    <table role="presentation" width="100%" style={{ backgroundColor: "#f5f7f9", borderRadius: "6px", margin: "22px 0" }}><tbody><tr><td style={{ padding: "18px" }}>
      <p style={{ ...s.label, marginBottom: "10px" }}>{pt ? "COMO COMEÇAR" : "GET STARTED"}</p>
      <p style={{ ...s.paragraph, marginBottom: "8px" }}>1. {pt ? "Abra o convite no botão abaixo." : "Open your invitation using the button below."}</p>
      <p style={{ ...s.paragraph, marginBottom: "8px" }}>2. {pt ? "Entre ou crie a sua conta com o endereço de email que recebeu este convite." : "Sign in or create your account using the email address that received this invitation."}</p>
      <p style={{ ...s.paragraph, marginBottom: 0 }}>3. {pt ? "Siga as instruções no portal para preparar a acreditação." : "Follow the portal instructions to prepare accreditation."}</p>
    </td></tr></tbody></table>
    <p style={s.small}><strong>{pt ? "Convite válido até:" : "Invitation valid until:"}</strong><br/>{expiry}</p>
    <EmailAction url={url} label={pt ? "Aceitar convite" : "Accept invitation"}/>
    <p style={s.small}>{pt ? "Este convite destina-se apenas a si. Não partilhe a ligação. Se não esperava este convite, não é necessário fazer nada." : "This invitation is intended only for you. Do not share the link. If you were not expecting it, no action is needed."}</p>
  </EmailLayout>);
  const text = pt
    ? `Foi convidado para gerir ${companyName} no portal AIA.\n\nEntre ou crie a sua conta com o endereço que recebeu este convite.\nConvite válido até: ${expiry}\n\nAceitar convite: ${url}\n\nNão partilhe esta ligação. Se não esperava este convite, não é necessário fazer nada.`
    : `You were invited to manage ${companyName} in the AIA portal.\n\nSign in or create your account using the email address that received this invitation.\nInvitation valid until: ${expiry}\n\nAccept invitation: ${url}\n\nDo not share this link. If you were not expecting it, no action is needed.`;
  return { subject, html, text };
}
