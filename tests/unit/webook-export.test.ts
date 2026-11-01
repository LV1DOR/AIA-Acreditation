import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { weBookHeaders, weBookWorkbook } from "../../packages/domain/src/exports/webook.ts";
import { attendeeQrCodeValue } from "../../packages/domain/src/exports/qr-code-value.ts";

const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
const Excel = require("exceljs") as { Workbook: new () => {
  xlsx: { load(bytes: Uint8Array): Promise<unknown> };
  worksheets: { name: string; rowCount: number; getCell(row: number, column: number): { value: unknown; numFmt: string } }[];
} };
it("exports the exact WeBook columns with stable text QR values and literal names", async () => {
  const attendeeId = "00000000-0000-4000-8000-000000000001";
  const book = new Excel.Workbook();
  await book.xlsx.load(await weBookWorkbook([{ id: attendeeId, fullName: "=Synthetic Name", zones: ["Paddock", "Pit Lane"] }]));
  const sheet = book.worksheets[0]!;
  expect(sheet.name).toBe("WeBook");
  expect(weBookHeaders.map((_, i) => sheet.getCell(1, i + 1).value)).toEqual(["QR Code Value", "Full Name", "Zone(s)"]);
  expect(sheet.getCell(2, 1).value).toBe(attendeeQrCodeValue(attendeeId));
  expect(sheet.getCell(2, 1).numFmt).toBe("@");
  expect(sheet.getCell(2, 2).value).toBe("=Synthetic Name");
  expect(sheet.getCell(2, 3).value).toBe("Paddock, Pit Lane");
});
it("rejects incomplete and empty exports rather than making partial workbooks", async () => {
  await expect(weBookWorkbook([])).rejects.toMatchObject({ code: "NO_APPROVED_ATTENDEES" });
  await expect(weBookWorkbook([{ id: randomUUID(), fullName: "Synthetic", zones: [] }])).rejects.toMatchObject({ code: "INCOMPLETE_ATTENDEE" });
});
