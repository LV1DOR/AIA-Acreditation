**AIA → ID-ALL: implemented Excel and photo export**

Updated 25 October 2026 to reflect the confirmed implementation scope. All approved attendees for the selected event are exported each time, including people previously exported. There is no export or print tracking.

**Using it**

Open Exports / Exportações in the admin sidebar, select the event, then click `Export for ID-ALL` / `Exportar para ID-ALL`. This downloads `ID-ALL.zip`. Table search, company and other filters do not restrict the export: it always includes the event's complete currently approved set.

```text
ID-ALL.zip
  ID-ALL.xlsx
  Fotos/
    <participant-id>.jpg
    ...
```

Only the spreadsheet and corresponding photographs are included. There are no profiles, ELMS formats, manifests, instruction files or generated QR images in the package.

**Fixed spreadsheet format**

Workbook: `ID-ALL.xlsx`. Worksheet: `Folha1`. Row 1 contains these exact headers:

| Column | Header | Every exported data row |
|---|---|---|
| A | `Codigos` | Always empty, formatted as Text for manual pasting. |
| B | `NOME` | Approved attendee name. |
| C | `FUNÇÃO` | Approved role. |
| D | `foto` | Filename matching the person's JPEG in `Fotos`. |
| E | `função` | Same role as C, preserving the supplied staff field mapping. |

Column A contains only its header; the app never supplies a WeBook value. Data starts in B. Preserve QR values as text when pasting, including leading zeros. Each fresh export starts with blank codes, even if an operator filled codes in an earlier downloaded copy.

Photo filenames use stable participant identifiers. They do not depend on the manual code column, so pasting or changing codes does not break photo references. ID-ALL resolves each photograph through its `foto` field. The source is the approved submission photograph, including the latest photo adjustment made during AIA review.

**One-time ID-ALL configuration**

On the actual printing PC, choose a fixed working directory such as `C:\AIA\ID-ALL`. Extract the workbook and `Fotos` folder there. Configure a copy of the card project to connect to `ID-ALL.xlsx`, sheet `Folha1`, headers in row 1. Set `Codigos` to Text and `foto` to the image field type, with indexed-image lookup pointing to that directory's `Fotos` folder.

Map name and role to the corresponding headers. Configure a QR-Code element linked to `Codigos`; the old staff screenshot uses Code 128 B, so changing the column name alone is insufficient. ID-ALL Standard supports QR-Code: [vendor documentation](https://support.cardpresso.com/knowledgebase/idall1/idall-encoding/).

For each export, close Excel and the relevant ID-ALL project, replace the working dataset, paste the correct codes alongside each person, save and close Excel, then reopen/refresh ID-ALL and preview/print. Avoid sorting a pasted code column independently of the rest of the rows. Keep the original printing project and historical master spreadsheet separate from this working export folder.

The vendor's [Excel guide](https://www.cardpressodownloads.com/filesforclient/Private/Support/ID-ALL/5%20-%20ID-ALL%20-%20How%20to%20connect%20to%20an%20Excel%20file.pdf) and [indexed-image guide](https://www.cardpressodownloads.com/filesforclient/Private/Support/ID-ALL/3%20-%20ID-ALL%20-%20How%20to%20configure%20the%20Point%20to%20Indexed%20Images%20feature.pdf) describe these connection settings. Excel must remain closed while ID-ALL uses the workbook.

**Application behavior**

The endpoint is admin-only and scoped to the explicitly selected event. It uses current approval and participant versions, excludes removed/erased/withdrawn records, and includes both internal and external approved attendees. No previous-export check exists.

If no approved attendees exist, or a required approved name, role or photograph is unavailable, the UI displays an error rather than returning an incomplete download. Approved data is checked again before the ZIP is offered. Photographs are read sequentially; a temporary archive is removed after download, cancellation or failure. No persistent export records or copies are created.

Implementation decision: `docs/ADR/0006-id-all-manual-code-export.md`. The original provisional embedded-photo export and print-tracking proposal are superseded for this feature.

**Acceptance on the printing PC**

Confirm that ID-ALL refreshes the full row range after both a larger and a smaller export. Preview accented names, long roles and the matching photos. Paste a test value as text and confirm the scanner reads that exact value from the QR. Once WeBook provides valid values, verify recognition in their system and print a physical proof. These device-specific checks require the actual printing PC and have not been performed by the development environment.
