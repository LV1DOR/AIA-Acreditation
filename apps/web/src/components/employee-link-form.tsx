"use client";

import { useActionState, useState } from "react";
import { createEmployeeLinkAction } from "../app/[locale]/company/[registrationId]/actions.ts";

export function EmployeeLinkForm({ locale, participantId, registrationId, labels }: {
  locale: "pt" | "en"; participantId: string; registrationId: string;
  labels: { generate: string; copy: string; ready: string; unavailable: string };
}) {
  const [state, action, pending] = useActionState(createEmployeeLinkAction, {});
  const [copied, setCopied] = useState(false);
  return <div className="employee-link-box">
    <form action={action}>
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="participantId" value={participantId}/><input type="hidden" name="registrationId" value={registrationId}/>
      <button className="button secondary" disabled={pending}>{labels.generate}</button>
    </form>
    {state.link && <div className="generated-link"><p>{labels.ready}</p><code>{state.link}</code><button type="button" className="text-button" onClick={() => { void navigator.clipboard.writeText(state.link!); setCopied(true); }}>{copied ? "✓" : labels.copy}</button></div>}
    {state.error && <p className="small error-text">{labels.unavailable}</p>}
  </div>;
}
