import { Readable } from "node:stream";
import { z } from "zod";
import { IdAllExportError, type IdAllAttendee } from "./id-all.ts";
import { attendeeQrCodeValue } from "./qr-code-value.ts";

export const idAllHeaders = ["Codigos", "NOME", "FUNÇÃO", "foto", "função"] as const;
export const ID_ALL_WORKBOOK = "ID-ALL.xlsx";

export async function idAllWorkbook(attendees: readonly IdAllAttendee[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Folha1");
  sheet.columns = idAllHeaders.map((header, index) => ({ header, width: [24, 36, 40, 42, 40][index] }));
  sheet.getColumn(1).numFmt = "@";
  sheet.getRow(1).font = { bold: true };
  for (const attendee of attendees) {
    // Literal strings, never formulas. The stable QR payload is shared with WeBook.
    // The stable photo reference remains independent of the shared QR payload.
    z.uuid().parse(attendee.id);
    sheet.addRow([attendeeQrCodeValue(attendee.id), attendee.fullName, attendee.role, `${attendee.id}.jpg`, attendee.role]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function idAllArchive(attendees: readonly IdAllAttendee[], loadPhoto: (key: string) => Promise<Uint8Array>): Promise<Readable> {
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  archive.file(ID_ALL_WORKBOOK, await idAllWorkbook(attendees));
  const seen = new Set<string>();
  for (const attendee of attendees) {
    if (seen.has(attendee.id)) throw new Error("DUPLICATE_EXPORT_ATTENDEE");
    seen.add(attendee.id);
    // JSZip consumes these streams in sequence, so large events do not require
    // loading every photograph into server memory at the same time.
    const photo = Readable.from((async function* () {
      try {
        const bytes = await loadPhoto(attendee.photoObjectKey);
        if (bytes.byteLength < 3 || bytes.byteLength > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
          throw new Error("INVALID_PROCESSED_PHOTO");
        }
        yield Buffer.from(bytes);
      } catch {
        throw new IdAllExportError("PHOTO_UNAVAILABLE", attendee.fullName);
      }
    })());
    archive.file(`Fotos/${attendee.id}.jpg`, photo, { createFolders: false });
  }
  // XLSX and JPEG are already compressed; STORE avoids needless CPU work.
  // JSZip exposes a legacy Node stream. Wrap it in a native Readable for
  // pipeline cancellation/backpressure and async iteration.
  return new Readable().wrap(archive.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" }));
}
