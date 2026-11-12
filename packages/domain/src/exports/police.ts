import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import type { ActorContext } from "../shared/actor.ts";
import { DomainError } from "../shared/errors.ts";
import { transaction } from "../shared/transaction.ts";
import { revealDocumentNumber } from "../participants/identity.ts";
import { companyStatusLabels } from "./company-status.ts";

const personLabels: Record<string, string> = { DRAFT: "Rascunho", AWAITING_EMPLOYEE: "A aguardar a pessoa", AWAITING_LEADER_REVIEW: "A aguardar revisão", LEADER_APPROVED: "Aprovado pelo responsável", DUPLICATE_REVIEW_REQUIRED: "Verificação AIA necessária" };
const documentLabels: Record<string, string> = { PASSPORT: "Passaporte", CARTAO_CIDADAO: "Cartão de cidadão", CARTAO_RESIDENCIA: "Cartão de residência" };
export const policeHeaders = ["Evento", "Empresa", "Tipo de pessoa", "Responsável principal", "Email", "Estado da inscrição", "Estado da pessoa", "Nome completo", "Tipo de documento", "Número de documento", "Data de nascimento", "Validade do documento", "Nacionalidade (código ISO)", "Telemóvel", "Função", "Dias de trabalho", "Zonas solicitadas", "Versão do aviso de privacidade", "Privacidade reconhecida em", "Referência interna", "ID do participante"] as const;
export type PoliceRow = { values: string[] };
export type PoliceData = { workers: PoliceRow[]; responsible: PoliceRow[] };
export class PoliceExportError extends Error {
  constructor(public readonly code: "DOCUMENT_UNAVAILABLE") { super(code); }
}
const date = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? "";
const instant = (value: Date | null | undefined) => value?.toISOString() ?? "";

export async function policeExportData(db: PrismaClient, context: ActorContext, eventId: string, key: string): Promise<PoliceData> {
  return transaction(db, async tx => {
    requireAdmin(await resolveActor(tx, context));
    if (!z.uuid().safeParse(eventId).success) throw new DomainError("INVALID_INPUT");
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { name: true } });
    if (!event) throw new DomainError("NOT_FOUND");
    const registrations = await tx.companyEventRegistration.findMany({
      where: { eventId, withdrawnAt: null, erasedAt: null, company: { deactivatedAt: null } },
      orderBy: [{ company: { name: "asc" } }, { id: "asc" }],
      include: {
        company: { include: { memberships: { where: { revokedAt: null, user: { disabledAt: null, role: "COMPANY_LEADER" } }, orderBy: { id: "asc" } } } },
        invitations: { where: { revokedAt: null, usedAt: { not: null } }, orderBy: [{ usedAt: "desc" }, { id: "desc" }] },
        participants: { where: { erasedAt: null, status: { notIn: ["REMOVED", "REPLACED"] } }, orderBy: [{ fullName: "asc" }, { id: "asc" }], include: { jobRole: true, workDays: { orderBy: { workDate: "asc" } }, individualZones: { include: { eventZone: { include: { zone: true } } } } } },
        zones: { include: { eventZone: { include: { zone: true } } } },
      },
    });
    const data: PoliceData = { workers: [], responsible: [] };
    for (const registration of registrations) {
      const emailFor = (userId: string) => registration.invitations.find(invitation => invitation.acceptedByUserId === userId)?.emailNormalized ?? "";
      const rowFor = (person: typeof registration.participants[number] | undefined, membership: typeof registration.company.memberships[number] | undefined): PoliceRow => {
        let documentNumber: string;
        try { documentNumber = person ? revealDocumentNumber(person, key) ?? "" : ""; }
        catch { throw new PoliceExportError("DOCUMENT_UNAVAILABLE"); }
        const primary = membership ? membership.id === registration.primaryLeaderMembershipId : false;
        const zones = person ? (registration.company.internalOrganisation ? person.individualZones : registration.zones).map(item => item.eventZone.zone.name).sort((a, b) => a.localeCompare(b, "pt")) : [];
        return { values: [
          event.name, registration.company.name, membership ? "Responsável" : "Trabalhador", membership ? primary ? "Sim" : "Não" : "",
          membership ? emailFor(membership.userId) : "", companyStatusLabels[registration.status], person ? personLabels[person.status] ?? person.status : "Sem perfil pessoal",
          person?.fullName ?? "", person?.documentType ? documentLabels[person.documentType] ?? person.documentType : "", documentNumber,
          date(person?.dateOfBirth), date(person?.documentExpiryDate), person?.nationalityCode ?? "", person?.mobileE164 ?? "", person?.jobRole?.name ?? "",
          person?.workDays.map(day => date(day.workDate)).join(", ") ?? "", zones.join(", "),
          person?.privacyNoticeVersion ?? "", instant(person?.privacyAcknowledgedAt), person?.internalReference?.startsWith("leader-self:") ? "" : person?.internalReference ?? "", person?.id ?? "",
        ] };
      };
      for (const person of registration.participants) {
        const membership = registration.company.memberships.find(member => person.internalReference === `leader-self:${member.userId}`);
        data.workers.push(rowFor(person, membership));
      }
      for (const member of registration.company.memberships) {
        const person = registration.participants.find(item => item.internalReference === `leader-self:${member.userId}`);
        data.responsible.push(rowFor(person, member));
      }
    }
    return data;
  });
}

export async function policeWorkbook(data: PoliceData) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of [["Trabalhadores", data.workers], ["Responsáveis", data.responsible]] as const) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = policeHeaders.map(header => ({ header, width: 30, style: { numFmt: "@" } }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of rows) {
      sheet.addRow(row.values);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
