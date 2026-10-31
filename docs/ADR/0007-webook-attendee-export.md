# ADR 0007: WeBook attendee spreadsheet export

Accepted 2026-10-31.

Add a separate WeBook download to the dedicated Exports page. Each download is a
normal `WeBook.xlsx` workbook with one sheet and three columns in this order:

1. `QR Code Value`
2. `Full Name`
3. `Zone(s)`

The export includes every currently approved attendee for the selected event on
each click, including people exported previously. Names and zones come from the
current approved submission. Company attendees receive the approved event zones;
AIA and Parkalgar attendees receive their individually assigned zones. Zone names
follow the event's configured zone order.

The QR code values are not stored on attendee records in this application. The
first column is therefore left blank and formatted as text for the operator to
paste values into before sending the workbook to WeBook. The download does not
change attendee data or create an export/print status. An attendee with no name or
no active assigned zone blocks the export instead of producing an incomplete row.

This workbook contains only the three requested fields. It has no photos, card
profile, event metadata, batch identifier, or extra instruction sheet.
