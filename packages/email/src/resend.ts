import { Resend } from "resend";

// Verification is local cryptography. A non-secret placeholder avoids requiring
// a sending API key in the web process; this client never calls a Resend API.
const verifier = new Resend("verification-only");
export function verifyResendWebhook(payload: string, headers: Headers, webhookSecret: string): unknown {
  return verifier.webhooks.verify({ payload, webhookSecret, headers: {
    id: headers.get("svix-id") ?? "",
    timestamp: headers.get("svix-timestamp") ?? "",
    signature: headers.get("svix-signature") ?? "",
  } });
}

// Reconciliation deliberately uses List, whose response excludes email bodies.
// Never return the SDK client, headers, API errors or raw response to an Admin.
export function resendMetadataReader(apiKey: string) {
  const client = new Resend(apiKey);
  return async (after?: string) => {
    const { data, error } = await client.emails.list({ limit: 100, ...(after ? { after } : {}) });
    if (error || !data) throw new Error("RESEND_RECONCILIATION_UNAVAILABLE");
    return { hasMore: data.has_more, messages: data.data.map(m => ({
      id: m.id, messageId: m.message_id, to: m.to, createdAt: m.created_at, status: m.last_event, from: m.from, subject: m.subject,
    })) };
  };
}
