import type { Prisma } from "@aia/database";
import type { Tx } from "../shared/transaction.ts";
import { DomainError } from "../shared/errors.ts";
import { isPublishedEvent } from "../events/lifecycle.ts";
import { normalizePhoneNumber } from "../participants/phone.ts";
import {validateWorkerNoticeEvidence} from "../privacy/notices.ts";

export async function validateParticipantEligibility(tx: Tx, person: Prisma.EventParticipantGetPayload<Record<string, never>>, event: { startDate: Date; endDate: Date }) {
  const days = await tx.participantWorkDay.findMany({ where: { participantId: person.id } });
  const role = person.jobRoleId && await tx.jobRole.findFirst({ where: { id: person.jobRoleId, deactivatedAt: null } });
  assertParticipantData(person,event,Boolean(role),days);
  await validateWorkerNoticeEvidence(tx,[person]);
  const registration=await tx.companyEventRegistration.findUniqueOrThrow({where:{id:person.registrationId},include:{company:true}});
  if(registration.company.internalOrganisation) {
    const zones=await tx.participantZoneRequest.findMany({where:{participantId:person.id,eventId:person.eventId},include:{eventZone:{include:{zone:true}}}});
    if(!zones.length || zones.some(x=>x.eventZone.deactivatedAt || x.eventZone.zone.deactivatedAt)) throw new DomainError("SUBMISSION_INCOMPLETE");
  }
}

function assertParticipantData(person:Prisma.EventParticipantGetPayload<Record<string,never>>,event:{startDate:Date;endDate:Date},activeRole:boolean,days:{workDate:Date}[]) {
  if (!person.fullName?.trim() || person.fullName.trim().length < 2 || !person.dateOfBirth || person.dateOfBirth > new Date() ||
      !person.documentType || !person.documentNumberCiphertext || !person.documentNumberIv || !person.documentNumberAuthTag || !person.documentNumberKeyVersion || !person.documentNumberFingerprint ||
      !person.documentExpiryDate || person.documentExpiryDate < event.endDate || !person.mobileE164 || !/^[A-Z]{2}$/.test(person.nationalityCode ?? "") ||
      !person.photoObjectKey || !person.privacyAcknowledgedAt || !person.privacyNoticeVersion || !activeRole || !days.length ||
      days.some(day => day.workDate < event.startDate || day.workDate > event.endDate)) throw new DomainError("SUBMISSION_INCOMPLETE");
  try { if (normalizePhoneNumber(person.mobileE164) !== person.mobileE164) throw new Error(); }
  catch { throw new DomainError("SUBMISSION_INCOMPLETE"); }
}

export async function validateRegistrationEligibility(tx: Tx, registrationId: string) {
  // Batch relation loading avoids two queries per worker for large internal workforces.
  const registration = await tx.companyEventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { company: true, event: true, participants: {include:{jobRole:true,workDays:true,individualZones:{include:{eventZone:{include:{zone:true}}}}}}, zones: { include: { eventZone: { include: { zone: true } } } }, vehiclePass: true } });
  const active = registration.participants.filter(person => !["REMOVED", "REPLACED"].includes(person.status));
  await validateWorkerNoticeEvidence(tx,active);
  if (registration.company.deactivatedAt || !isPublishedEvent(registration.event.status) || !active.length || active.length > registration.personnelLimit ||
      active.some(person => person.status !== "LEADER_APPROVED") || (!registration.company.internalOrganisation && (!registration.zones.length ||
      registration.zones.some(item => item.eventZone.deactivatedAt || item.eventZone.zone.deactivatedAt) || !registration.vehiclePass ||
      (registration.vehiclePass.required && (!registration.vehiclePass.requestedQuantity || !registration.vehiclePass.justification?.trim()))))) throw new DomainError("SUBMISSION_INCOMPLETE");
  for (const person of active) {
    assertParticipantData(person,registration.event,Boolean(person.jobRole && !person.jobRole.deactivatedAt),person.workDays);
    if(registration.company.internalOrganisation) {
      const zones=person.individualZones;
      if(!zones.length || zones.some(x=>x.eventZone.deactivatedAt || x.eventZone.zone.deactivatedAt)) throw new DomainError("SUBMISSION_INCOMPLETE");
    }
  }
}
