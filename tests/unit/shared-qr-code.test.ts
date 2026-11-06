import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { attendeeQrCodeValue } from "../../packages/domain/src/exports/qr-code-value.ts";
import { idAllWorkbook } from "../../packages/domain/src/exports/id-all-archive.ts";
import { weBookWorkbook } from "../../packages/domain/src/exports/webook.ts";
const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
const Excel = require("exceljs") as { Workbook: new () => {
  xlsx: { load(bytes: Uint8Array): Promise<unknown> };
  worksheets: { getCell(row: number, column: number): { value: unknown; numFmt: string } }[];
} };
const id = "00000000-0000-4000-8000-000000000001";
it("encodes the exact UUID bytes as a standard Base64 identifier", () => {
  const code = attendeeQrCodeValue(id);
  expect(code).toBe("AAAAAAAAQACAAAAAAAAAAQ==");
  expect(code).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  expect(Buffer.from(code, "base64").toString("hex")).toBe(id.replaceAll("-", ""));
});
it("keeps identity stable across normalization and distinguishes participants", () => {
  const other = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  expect(attendeeQrCodeValue(other.toUpperCase())).toBe(attendeeQrCodeValue(other));
  expect(attendeeQrCodeValue(other)).not.toBe(attendeeQrCodeValue(id));
});
it("refuses malformed identifiers instead of silently truncating hex", () => {
  for (const value of ["", "synthetic", id + "00", "00000000-0000-4000-8000-00000000000z"])
    expect(() => attendeeQrCodeValue(value)).toThrow();
});
it("uses the same literal text QR across both formats and repeat downloads", async () => {
  const person = { id, fullName: "=Synthetic Attendee", role: "Synthetic Role", photoObjectKey: "synthetic/photo", companyName: "Synthetic Company" };
  const values: unknown[] = [];
  for (let download = 0; download < 2; download++) {
    for (const bytes of [await idAllWorkbook([person]), await weBookWorkbook([{ id, fullName: person.fullName, zones: ["Synthetic Zone"] }])]) {
      const book = new Excel.Workbook();
      await book.xlsx.load(bytes);
      const cell = book.worksheets[0]!.getCell(2, 1);
      expect(cell.numFmt).toBe("@");
      expect(book.worksheets[0]!.getCell(2, 2).value).toBe(person.fullName);
      values.push(cell.value);
    }
  }
  expect(values).toEqual(Array(4).fill("AAAAAAAAQACAAAAAAAAAAQ=="));
});
