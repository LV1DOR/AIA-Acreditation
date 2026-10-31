import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { idAllArchive, idAllHeaders, idAllWorkbook } from "../../packages/domain/src/exports/id-all-archive.ts";
import type { IdAllAttendee } from "../../packages/domain/src/exports/id-all.ts";

const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
type Sheet = { name: string; rowCount: number; columnCount: number; getCell(row: number, column: number): { value: unknown; numFmt: string } };
type Book = { worksheets: Sheet[]; xlsx: { load(bytes: Uint8Array): Promise<unknown> } };
const Excel = require("exceljs") as { Workbook: new () => Book };
const Zip = require("jszip") as { loadAsync(bytes: Uint8Array): Promise<{ files: Record<string, { async(type: "uint8array"): Promise<Uint8Array> }> }> };
const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const people: IdAllAttendee[] = [
  { id: randomUUID(), fullName: "Álvaro Synthetic", role: "Operações", photoObjectKey: "private/original" },
  { id: randomUUID(), fullName: "=Literal Name", role: "@Literal Role", photoObjectKey: "private/adjusted" },
];
async function readWorkbook(bytes: Uint8Array) { const book = new Excel.Workbook(); await book.xlsx.load(bytes); return book; }
async function packageBytes(load: (key: string) => Promise<Uint8Array> = async () => photo) {
  const stream = await idAllArchive(people, load);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

it("exports the fixed Staff fields starting in B and leaves every Codigos cell empty and text-formatted", async () => {
  const book = await readWorkbook(await idAllWorkbook(people));
  expect(book.worksheets).toHaveLength(1);
  const sheet = book.worksheets[0]!;
  expect(sheet.name).toBe("Folha1");
  expect(sheet.rowCount).toBe(3);
  expect(sheet.columnCount).toBe(5);
  expect(idAllHeaders.map((_, i) => sheet.getCell(1, i + 1).value)).toEqual(["Codigos", "NOME", "FUNÇÃO", "foto", "função"]);
  people.forEach((person, i) => {
    expect(sheet.getCell(i + 2, 1).value).toBeNull();
    expect(sheet.getCell(i + 2, 1).numFmt).toBe("@");
    expect(sheet.getCell(i + 2, 2).value).toBe(person.fullName);
    expect(sheet.getCell(i + 2, 3).value).toBe(person.role);
    expect(sheet.getCell(i + 2, 4).value).toBe(`${person.id}.jpg`);
    expect(sheet.getCell(i + 2, 5).value).toBe(person.role);
  });
});

it("contains only the workbook and matching photographs, and exports every person again", async () => {
  const load = vi.fn<(key: string) => Promise<Uint8Array>>().mockResolvedValue(photo);
  for (let attempt = 0; attempt < 2; attempt++) {
    const zip = await Zip.loadAsync(await packageBytes(load));
    expect(Object.keys(zip.files).sort()).toEqual(["ID-ALL.xlsx", ...people.map(person => `Fotos/${person.id}.jpg`)].sort());
    const sheet = (await readWorkbook(await zip.files["ID-ALL.xlsx"]!.async("uint8array"))).worksheets[0]!;
    expect(sheet.rowCount).toBe(people.length + 1);
    for (const person of people) expect(Buffer.from(await zip.files[`Fotos/${person.id}.jpg`]!.async("uint8array"))).toEqual(photo);
  }
  expect(load.mock.calls.map(args => args[0])).toEqual([...people, ...people].map(person => person.photoObjectKey));
});

it("fails the archive if any required photograph is unavailable instead of silently dropping a row", async () => {
  await expect(packageBytes(async key => { if (key === people[1]!.photoObjectKey) throw new Error("NoSuchKey"); return photo; }))
    .rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE", attendeeName: people[1]!.fullName });
});

it.each([Buffer.from("not a JPEG"), Buffer.alloc(2 * 1024 * 1024 + 1)])("rejects invalid or oversized photograph bytes", async bytes => {
  await expect(packageBytes(async () => bytes)).rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
});

it("rejects unsafe photo filenames and duplicate attendees", async () => {
  await expect(idAllArchive([{ ...people[0]!, id: "../escape" }], async () => photo)).rejects.toThrow();
  await expect(idAllArchive([people[0]!, people[0]!], async () => photo)).rejects.toThrow("DUPLICATE_EXPORT_ATTENDEE");
});
