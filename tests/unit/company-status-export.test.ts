import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { PrismaClient } from "../../packages/database/src/index.ts";
import { beforeEach, expect, it, vi } from "vitest";
import { companyStatusRows, companyStatusWorkbook, type CompanyStatusRow } from "../../packages/domain/src/exports/company-status.ts";
const auth = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../../packages/domain/src/auth/authorization.ts", async original => ({ ...await original<typeof import("../../packages/domain/src/auth/authorization.ts")>(), resolveActor: auth.resolve }));
beforeEach(() => auth.resolve.mockResolvedValue({ role: "ADMIN" }));
const require = createRequire(new URL("../../packages/domain/package.json", import.meta.url));
const Excel = require("exceljs") as { Workbook: new () => { xlsx: { load(bytes: Uint8Array): Promise<unknown> }; worksheets: { rowCount: number; columnCount: number; getCell(row: number, column: number): { value: unknown } }[] } };
const context = { clerkUserId: "synthetic", correlationId: randomUUID() };
function fixture(rows: unknown[] = []) {
  const tx = { event: { findUnique: vi.fn().mockResolvedValue({ id: randomUUID() }) }, companyEventRegistration: { findMany: vi.fn().mockResolvedValue(rows) } };
  const db = { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
  return { tx, db };
}
const invite = (email: string, user: string | null = "current") => ({ emailNormalized: email, acceptedByUserId: user, usedAt: user ? new Date() : null, expiresAt: new Date("2099-01-01") });
const leader = { userId: "current", revokedAt: null, user: { disabledAt: null, role: "COMPANY_LEADER" } };
it("exports exactly Empresa, Email, Estado as literal Excel cells and Portuguese statuses", async () => {
  const book = new Excel.Workbook();
  const states: CompanyStatusRow["status"][] = ["DRAFT", "AIA_REVIEW", "RETURNED_FOR_CORRECTION", "REJECTED", "APPROVED"];
  await book.xlsx.load(await companyStatusWorkbook(states.map(status => ({ companyName: "=Synthetic", email: "+contact@example.test", status }))));
  const sheet = book.worksheets[0]!;
  expect(sheet.columnCount).toBe(3);
  expect([1, 2, 3].map(column => sheet.getCell(1, column).value)).toEqual(["Empresa", "Email", "Estado"]);
  expect(sheet.getCell(2, 1).value).toBe("=Synthetic");expect(sheet.getCell(2, 2).value).toBe("+contact@example.test");
  expect(states.map((_, index) => sheet.getCell(index + 2, 3).value)).toEqual(["Rascunho", "Em revisão AIA", "Devolvido para correção", "Rejeitado", "Aprovado"]);
});
it("produces a header-only workbook when the event has no companies", async () => {
  const book = new Excel.Workbook();await book.xlsx.load(await companyStatusWorkbook([]));expect(book.worksheets[0]!.rowCount).toBe(1);
});
it("uses the current primary leader's accepted invitation, never another leader or a pending replacement", async () => {
  const f = fixture([{ company: { name: "Synthetic" }, status: "APPROVED", primaryLeader: leader, invitations: [invite("pending@example.test", null), invite("old@example.test", "former"), invite("correct@example.test")] }]);
  expect(await companyStatusRows(f.db, context, randomUUID())).toEqual([{ companyName: "Synthetic", email: "correct@example.test", status: "APPROVED" }]);
  expect(f.tx.companyEventRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ withdrawnAt: null, erasedAt: null, company: { deactivatedAt: null, internalOrganisation: null } }) }));
});
it("includes draft and returned companies and pending invitations, with blank missing contacts", async () => {
  const f = fixture([
    { company: { name: "Draft" }, status: "DRAFT", primaryLeader: null, invitations: [invite("invited@example.test", null)] },
    { company: { name: "Returned" }, status: "RETURNED_FOR_CORRECTION", primaryLeader: leader, invitations: [invite("former@example.test", "former")] },
    { company: { name: "Disabled" }, status: "APPROVED", primaryLeader: { ...leader, user: { ...leader.user, disabledAt: new Date() } }, invitations: [invite("disabled@example.test")] },
    { company: { name: "Expired" }, status: "DRAFT", primaryLeader: null, invitations: [{ ...invite("expired@example.test", null), expiresAt: new Date(0) }] },
  ]);
  expect((await companyStatusRows(f.db, context, randomUUID())).map(row => row.email)).toEqual(["invited@example.test", "", "", ""]);
});
it("denies non-admins before reading event or company data", async () => {
  auth.resolve.mockResolvedValue({ role: "COMPANY_LEADER" });const f = fixture();
  await expect(companyStatusRows(f.db, context, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.tx.event.findUnique).not.toHaveBeenCalled();expect(f.tx.companyEventRegistration.findMany).not.toHaveBeenCalled();
});
it("rejects invalid and missing events without falling back to another event", async () => {
  const f = fixture();await expect(companyStatusRows(f.db, context, "invalid")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  f.tx.event.findUnique.mockResolvedValue(null);await expect(companyStatusRows(f.db, context, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.tx.companyEventRegistration.findMany).not.toHaveBeenCalled();
});
