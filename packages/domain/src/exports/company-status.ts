import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import type { ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";

export type CompanyStatusRow = { companyName: string; email: string; status: keyof typeof companyStatusLabels };
export const companyStatusLabels = {
  DRAFT: "Rascunho", AIA_REVIEW: "Em revisão AIA", RETURNED_FOR_CORRECTION: "Devolvido para correção",
  REJECTED: "Rejeitado", APPROVED: "Aprovado",
} as const;
export const companyStatusHeaders = ["Empresa", "Email", "Estado"] as const;

export async function companyStatusRows(db: PrismaClient, context: ActorContext, eventId: string): Promise<CompanyStatusRow[]> {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    if (!z.uuid().safeParse(eventId).success) throw new DomainError("INVALID_INPUT");
    if (!await tx.event.findUnique({ where: { id: eventId }, select: { id: true } })) throw new DomainError("NOT_FOUND");
    const registrations = await tx.companyEventRegistration.findMany({
      where: { eventId, withdrawnAt: null, erasedAt: null, company: { deactivatedAt: null, internalOrganisation: null } },
      orderBy: [{ company: { name: "asc" } }, { id: "asc" }],
      select: {
        company: { select: { name: true } }, status: true,
        primaryLeader: { select: { userId: true, revokedAt: true, user: { select: { disabledAt: true, role: true } } } },
        invitations: {
          where: { revokedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { emailNormalized: true, acceptedByUserId: true, usedAt: true, expiresAt: true },
        },
      },
    });
    const now = new Date();
    return registrations.map(registration => {
      const leader = registration.primaryLeader;
      // Match the current responsible contact; never substitute a former leader's email.
      const invitation = leader
        ? !leader.revokedAt && !leader.user.disabledAt && leader.user.role === "COMPANY_LEADER"
          ? registration.invitations.find(item => item.usedAt && item.acceptedByUserId === leader.userId)
          : undefined
        : registration.invitations.find(item => !item.usedAt && item.expiresAt > now);
      return { companyName: registration.company.name, email: invitation?.emailNormalized ?? "", status: registration.status };
    });
  });
}

export async function companyStatusWorkbook(rows: readonly CompanyStatusRow[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Empresas");
  sheet.columns = companyStatusHeaders.map((header, index) => ({ header, width: [44, 48, 30][index] }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow([row.companyName, row.email, companyStatusLabels[row.status]]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
