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
follow the event's configured zone order. WeBook maps those zones to ticket types.

The first column contains a stable Base64 value derived from the attendee's
event-participant UUID and is formatted as text. The same value is generated in the
ID-ALL card export, and repeated exports keep it stable for that attendee. WeBook
specifies QR values as Base64 alphanumeric strings up to 255 characters. The
download does not change attendee data or create an export/print status. An attendee
with no name or active assigned zone blocks the export instead of producing an
incomplete row.

This workbook contains only the three requested fields. It has no photos, card
profile, event metadata, batch identifier, or extra instruction sheet.
