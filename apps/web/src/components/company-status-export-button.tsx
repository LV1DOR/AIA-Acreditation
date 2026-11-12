"use client";

import { useState } from "react";
import type { Locale } from "@aia/i18n";

const copy = {
  pt: {
    label: "Exportar empresas", busy: "A preparar exportação…",
    scope: "Empresas do evento, com o email do responsável e o estado atual. Colunas: Empresa, Email, Estado.",
    errors: {
      STALE_WRITE: "Os dados das empresas mudaram durante a exportação. Tente novamente.",
      FORBIDDEN: "A sessão não permite esta exportação. Inicie sessão como administrador.",
      EXPORT_FAILED: "Não foi possível preparar a exportação. Tente novamente.",
    },
  },
  en: {
    label: "Export companies", busy: "Preparing export…",
    scope: "Event companies with their responsible contact’s email and current status. Columns: Empresa, Email, Estado.",
    errors: {
      STALE_WRITE: "Company details changed during the export. Please try again.",
      FORBIDDEN: "Your session cannot export these details. Sign in as an administrator.",
      EXPORT_FAILED: "The export could not be prepared. Please try again.",
    },
  },
};

export function CompanyStatusExportButton({ eventId, locale }: { eventId: string; locale: Locale }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const labels = copy[locale];
  async function download() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/company-status`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json() as { code?: string };
        const message = labels.errors[result.code as keyof typeof labels.errors] ?? labels.errors.EXPORT_FAILED;
        setError(message);
        return;
      }
      if (!response.headers.get("Content-Type")?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("UNEXPECTED_DOWNLOAD");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "Empresas.xlsx";
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
