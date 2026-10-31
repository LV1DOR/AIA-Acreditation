"use client";

import { useState } from "react";
import type { Locale } from "@aia/i18n";

const copy = {
  pt: {
    label: "Exportar para WeBook", busy: "A preparar exportação…",
    scope: "Todas as pessoas aprovadas e as respetivas zonas. Preencha manualmente os valores QR na primeira coluna.",
    errors: {
      NO_APPROVED_ATTENDEES: "Ainda não existem pessoas aprovadas para exportar neste evento.",
      INCOMPLETE_ATTENDEE: "Falta o nome ou a zona atribuída de uma pessoa aprovada. Corrija os dados e tente novamente.",
      STALE_WRITE: "Os dados aprovados mudaram durante a exportação. Tente novamente.",
      FORBIDDEN: "A sessão não permite esta exportação. Inicie sessão como administrador.",
      EXPORT_FAILED: "Não foi possível preparar a exportação. Tente novamente.",
    },
  },
  en: {
    label: "Export for WeBook", busy: "Preparing export…",
    scope: "All approved attendees and their assigned zones. Enter the QR values manually in the first column.",
    errors: {
      NO_APPROVED_ATTENDEES: "There are no approved attendees to export for this event yet.",
      INCOMPLETE_ATTENDEE: "An approved attendee is missing a name or assigned zone. Correct the details and try again.",
      STALE_WRITE: "Approved details changed during the export. Please try again.",
      FORBIDDEN: "Your session cannot export these details. Sign in as an administrator.",
      EXPORT_FAILED: "The export could not be prepared. Please try again.",
    },
  },
};

export function WeBookExportButton({ eventId, locale }: { eventId: string; locale: Locale }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const labels = copy[locale];
  async function download() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/webook`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json() as { code?: string; attendeeName?: string };
        const message = labels.errors[result.code as keyof typeof labels.errors] ?? labels.errors.EXPORT_FAILED;
        setError(`${message}${result.attendeeName ? ` (${result.attendeeName})` : ""}`);
        return;
      }
      if (!response.headers.get("Content-Type")?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("UNEXPECTED_DOWNLOAD");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "WeBook.xlsx";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError(labels.errors.EXPORT_FAILED); }
    finally { setBusy(false); }
  }
  return <div className="id-all-export">
    <button type="button" className="button secondary" onClick={download} disabled={busy} aria-busy={busy}>{busy ? labels.busy : labels.label}</button>
    <small>{labels.scope}</small>
    {error && <p className="flash error" role="alert">{error}</p>}
  </div>;
}
