import { Resend } from "resend";

// Standalone operator test only. Never imported by the portal or worker.
// There is intentionally no recipient parameter, CC, BCC or reply-to override.
export async function sendSingleAuthorizedTest(key: string, idempotencyKey: string) {
  const client = new Resend(key);
  const { data, error } = await client.emails.send({
    from: "AIA Email Test <notificacoes@notify.joinaia.pt>", to: ["lukevidor@gmail.com"],
    subject: "AIA — teste de entrega / email delivery test",
    text: "Este é o único email de teste autorizado para validar o acompanhamento de entrega AIA. Não é necessária qualquer ação.\n\nThis is the single authorised test email for AIA delivery monitoring. No action is required.",
  }, { idempotencyKey });
  if (error || !data?.id) throw new Error("RESEND_TEST_SEND_NOT_CONFIRMED");
  return data.id;
}
