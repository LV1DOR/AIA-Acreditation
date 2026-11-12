import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { beforeEach, expect, it, vi } from "vitest";
import { policeExportData, policeHeaders, policeWorkbook } from "../../packages/domain/src/exports/police.ts";
import { protectDocumentNumber } from "../../packages/domain/src/participants/identity.ts";
const auth = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../packages/domain/src/auth/authorization.ts", async original => ({ ...await original<typeof import("../../packages/domain/src/auth/authorization.ts")>(), resolveActor: auth.resolve }));
beforeEach(() => auth.resolve.mockResolvedValue({ role: "ADMIN" }));
const key = "a".repeat(64), fingerprintKey = "b".repeat(64);
const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
const Excel = require("exceljs") as { Workbook: new () => { xlsx: { load(bytes: Uint8Array): Promise<unknown> }; worksheets: { name: string; columnCount: number; rowCount: number; getCell(row: number, column: number): { value: unknown; numFmt: string } }[] } };
const context = { clerkUserId: "synthetic", correlationId: randomUUID() };
function fixture() {
  const id = randomUUID(), userId = randomUUID(), memberId = randomUUID();
  const person = { id, ...protectDocumentNumber("PASSPORT", "00001234567890123456789", id, key, fingerprintKey), fullName: "=Synthetic Responsible", status: "AWAITING_LEADER_REVIEW", documentType: "PASSPORT", dateOfBirth: new Date("1990-01-02"), documentExpiryDate: new Date("2030-03-04"), nationalityCode: "PT", mobileE164: "+351912345678", jobRole: { name: "Operations" }, internalReference: `leader-self:${userId}`, privacyNoticeVersion: "v1", privacyAcknowledgedAt: new Date("2026-10-01T12:34:56Z"), workDays: [{ workDate: new Date("2026-11-14") }], individualZones: [] };
  const member = { id: memberId, userId };
  const registration = { company: { name: "Synthetic", internalOrganisation: null, memberships: [member, { id: randomUUID(), userId: randomUUID() }] }, status: "RETURNED_FOR_CORRECTION", primaryLeaderMembershipId: memberId, participants: [person], invitations: [{ acceptedByUserId: userId, emailNormalized: "responsible@example.test" }], zones: [{ eventZone: { zone: { name: "Paddock" } } }] };
  const tx = { event: { findUnique: vi.fn().mockResolvedValue({ name: "Synthetic Event" }) }, companyEventRegistration: { findMany: vi.fn().mockResolvedValue([registration]) } };
  const db = { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
  return { db, tx, person, registration };
}
it("decrypts complete IDs and exports all entered identity/contact/work details with responsible profiles", async () => {
  const f = fixture(), data = await policeExportData(f.db, context, randomUUID(), key);
  expect(data.workers).toHaveLength(1);expect(data.responsible).toHaveLength(2);
  const row = Object.fromEntries(policeHeaders.map((header, i) => [header, data.workers[0]!.values[i]]));
  expect(row).toMatchObject({ "Número de documento": "00001234567890123456789", "Nome completo": "=Synthetic Responsible", "Data de nascimento": "1990-01-02", "Validade do documento": "2030-03-04", "Nacionalidade (código ISO)": "PT", "Telemóvel": "+351912345678", "Email": "responsible@example.test", "Função": "Operations", "Dias de trabalho": "2026-11-14", "Zonas solicitadas": "Paddock", "Tipo de pessoa": "Responsável", "Responsável principal": "Sim", "Estado da inscrição": "Devolvido para correção", "Privacidade reconhecida em": "2026-10-01T12:34:56.000Z" });
  expect(data.responsible[0]).toEqual(data.workers[0]);expect(data.responsible[1]!.values).toContain("Sem perfil pessoal");
  const serialized = JSON.stringify(data);expect(serialized).not.toContain(f.person.documentNumberCiphertext);expect(serialized).not.toContain(f.person.documentNumberFingerprint);expect(serialized).not.toContain("leader-self:");
  expect(policeHeaders).not.toContain("Fotografia");expect(serialized).not.toContain("photoObjectKey");
});
it("writes literal text IDs with leading zeroes and long numbers in both Excel sheets, with no photos", async () => {
  const f = fixture(), data = await policeExportData(f.db, context, randomUUID(), key), book = new Excel.Workbook();
  await book.xlsx.load(await policeWorkbook(data));expect(book.worksheets.map(sheet => sheet.name)).toEqual(["Trabalhadores", "Responsáveis"]);
  for (const sheet of book.worksheets) {
    expect(sheet.columnCount).toBe(policeHeaders.length);expect(sheet.getCell(2, 10).value).toBe("00001234567890123456789");expect(sheet.getCell(2, 10).numFmt).toBe("@");expect(sheet.getCell(2, 8).value).toBe("=Synthetic Responsible");
  }
});
it("fails closed for corrupt identity encryption without disclosing ciphertext or a partial export", async () => {
  const f = fixture();f.person.documentNumberAuthTag = "corrupt";
  await expect(policeExportData(f.db, context, randomUUID(), key)).rejects.toMatchObject({ code: "DOCUMENT_UNAVAILABLE" });
});
it("denies non-admins before accessing personal data", async () => {
  auth.resolve.mockResolvedValue({ role: "COMPANY_LEADER" });const f = fixture();await expect(policeExportData(f.db, context, randomUUID(), key)).rejects.toMatchObject({ code: "FORBIDDEN" });expect(f.tx.companyEventRegistration.findMany).not.toHaveBeenCalled();
});
it("selects every active status but excludes removed/erased people and withdrawn/inactive companies", async () => {
  const f = fixture();await policeExportData(f.db, context, randomUUID(), key);
  expect(f.tx.companyEventRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ withdrawnAt: null, erasedAt: null, company: { deactivatedAt: null } }), include: expect.objectContaining({ participants: expect.objectContaining({ where: { erasedAt: null, status: { notIn: ["REMOVED", "REPLACED"] } } }) }) }));
  const where = f.tx.companyEventRegistration.findMany.mock.calls[0]![0].where;expect(where).not.toHaveProperty("status");
});
it("retains headers for an empty event and rejects nonexistent or invalid event identifiers", async () => {
  const f = fixture();await expect(policeExportData(f.db, context, "invalid", key)).rejects.toMatchObject({ code: "INVALID_INPUT" });f.tx.event.findUnique.mockResolvedValue(null);await expect(policeExportData(f.db, context, randomUUID(), key)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const book = new Excel.Workbook();await book.xlsx.load(await policeWorkbook({ workers: [], responsible: [] }));expect(book.worksheets.map(sheet => sheet.rowCount)).toEqual([1, 1]);
});
