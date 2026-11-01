# ADR 0006: ID-ALL export with stable QR codes

Accepted 2026-10-25, following the operator's clarified requirements.

Provide one admin export for the selected event, available on the dedicated Exports
sidebar page (`/admin/exports`, localized as Exportações in Portuguese).
Each click includes all currently approved attendees, including attendees downloaded
previously. Table search/filter settings do not narrow this export. Draft, pending,
removed, erased, withdrawn and no-longer-approved records are excluded.

The download is `ID-ALL.zip`, containing only:

- `ID-ALL.xlsx`, worksheet `Folha1`.
- `Fotos/<participant-id>.jpg` for each exported row.

The fixed headers are `Codigos`, `NOME`, `FUNÇÃO`, `foto`, `função`, in columns A–E.
A1 contains `Codigos`; data cells in A contain the attendee's stable Base64 QR value
and are formatted as Text. The value is deterministically derived from the
event-participant UUID and is shared with the WeBook export. Names start in B. The
duplicate role column preserves the supplied staff mapping. Photo filenames remain
stable and independently identify the matching images.

Read the approved submission values and effective AIA photo adjustment. Recheck the
approved data after assembling the archive. An unavailable required image fails the
download rather than returning a partial package. Only admins can use the endpoint;
responses are private and not cached. Generate photographs sequentially and use a
temporary ZIP that is removed on completion, cancellation or failure.

There is no printed/exported status, export-history UI, export-batch model, profile
selector, manifest or instruction file. Repeated exports produce the same code for
each attendee while their participant ID remains unchanged.
The ID-ALL project is configured once to render QR from `Codigos` and resolve `foto`
against the local `Fotos` folder. Physical printing and WeBook scanner acceptance remain
operator checks on the printing PC.

For this ID-ALL feature, this decision supersedes ADR 0004's provisional card-print
adapter/history requirement and the provisional embedded-photo workbook in the original
handoff. It preserves approved-source consistency without persisting new export copies.
It does not implement or prescribe the future WeBook integration.
