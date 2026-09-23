import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createSmtpTransport } from "../../packages/email/src/index.ts";
it("delivers a synthetic bilingual message through SMTP into local Mailpit", async () => {
  const transport = createSmtpTransport({ host: "127.0.0.1", port: 11025, secure: false, from: "acreditacao@example.invalid" });
  const deliveryId = randomUUID();
  try {
    const result = await transport.send({
      deliveryId, to: "synthetic-leader@example.invalid",
      subject: "Teste / Test " + deliveryId,
      text: "Mensagem de teste. / Test message.",
      html: "<p>Mensagem de teste.</p><p>Test message.</p>",
    });
    expect(result.provider).toBe("smtp");
    const response = await fetch("http://127.0.0.1:18025/api/v1/search?query=" + encodeURIComponent("subject:" + deliveryId));
    expect(response.ok).toBe(true);
    const inbox = await response.json() as { messages: Array<{ Subject: string }> };
    expect(inbox.messages.filter(message => message.Subject === "Teste / Test " + deliveryId)).toHaveLength(1);
  } finally { transport.close(); }
});
