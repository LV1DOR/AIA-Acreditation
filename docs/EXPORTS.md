# Export design (Phase 9; not implemented in Phase 1)

Real production templates remain pending. Their absence must not delay working provisional exports once the export phase is reached.

Each export creates a new ExportBatch and immutable ExportBatchItems in a transaction, plus audit/outbox.
Background generation uses frozen snapshots, not later mutable participant rows, and writes a private MinIO object.
Retries use the same batch; a new user export creates a new batch. Authorised downloads are audited.
Sensitive snapshots are encrypted and processed photos use immutable version references. All PII copies enter retention scope.

## WeBook provisional

Adapter: ProvisionalWeBookExporter.
Version: webook-provisional-v1.
Sheet: WeBook Export.
Columns in order: QR / External QR ID; Nome / Full Name; Data de Nascimento / Date of Birth; Tipo de ID / ID Type; Nº ID / ID Number; Telemóvel / Mobile; Nacionalidade / Nationality; Organização / Organisation; Função / Job Role; Dias de Trabalho / Working Days.

## Matica MC210 provisional

Adapter: ProvisionalMaticaMC210Exporter.
Version: matica-mc210-provisional-v1.
Sheet: Card Print.
Columns in order: Photo; Nome / Full Name; Organização / Company; Função / Job Role; Tipo de ID / ID Type; Nº ID / ID Number; Nacionalidade / Nationality; Dias de Trabalho / Working Days; QR / External QR ID.

Embed processed photos in column A, anchored to the correct row; set readable dimensions and matching row heights.
Provisional dimensions are not claimed to match the final printer requirements.

Both use ExcelJS behind interfaces, stable row ordering, consistent calendar dates, explicit text cells for IDs/phones and no arbitrary formula interpretation.
No automatic Excel template inference.
Replace adapters after inspecting real files; retain historical exporter versions and verify actual WeBook import/Matica print workflow.
QR-related changes remain blocked on the unresolved policy rather than silently reusing a code.

