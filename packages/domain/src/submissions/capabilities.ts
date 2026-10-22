import type { Prisma, PrismaClient } from "@aia/database";
import { onboardingOpen } from "./edit-policy.ts";

type Client = Prisma.TransactionClient | PrismaClient;
const all = ["IDENTITY", "CONTACT", "ROLE", "WORK_DAYS", "PHOTO", "PRIVACY"] as const;
export type EditableField = typeof all[number];

// The same policy supplies UI controls and authorises writes. Grants never survive submission.
export async function participantCapabilities(db: Client, participantId: string, role: "ADMIN" | "COMPANY_LEADER") {
  const p = await db.eventParticipant.findUniqueOrThrow({ where: { id: participantId }, include: { registration: { include: { company: true, event: true } }, editRequest: true, replacementRequest: true } });
  const r = p.registration;
  const locked = { editable: false, fields: [] as EditableField[], canApprove: false, canRemove: false, canSaveDraft: false };
  if (r.withdrawnAt || r.erasedAt || p.erasedAt || r.company.deactivatedAt || ["DRAFT", "ARCHIVED"].includes(r.event.status) || ["REMOVED", "REPLACED"].includes(p.status) || !["DRAFT", "RETURNED_FOR_CORRECTION"].includes(r.status)) return locked;
  if (r.company.internalOrganisation && role !== "ADMIN") return locked;
  let fields: EditableField[] = [];
  const grant = p.editRequest ?? p.replacementRequest;
  if (grant?.status === "APPROVED" && !grant.fulfilledBySubmissionId) {
    const payload = grant.payload as { scope?: string };
    fields = grant.type === "CHANGE_WORK_DAYS" ? ["WORK_DAYS"] : grant.type === "REPLACE_PHOTO" ? ["PHOTO"] : grant.type === "EDIT_PERSON" && payload.scope !== "OTHER" ? [payload.scope as EditableField] : [...all];
  } else if (r.company.internalOrganisation && role === "ADMIN") fields = [...all];
  else if (r.status === "DRAFT" && onboardingOpen(r, new Date())) fields = [...all];
  else if (r.status === "RETURNED_FOR_CORRECTION") {
    const latest = await db.companySubmission.findFirst({ where: { registrationId: r.id }, orderBy: { version: "desc" }, include: { reviews: { orderBy: { createdAt: "desc" }, take: 1 }, participantReviews: true } });
    const returned = latest?.participantReviews.filter(x => x.outcome === "RETURNED_FOR_CORRECTION") ?? [];
    const personReview = returned.find(x => x.participantId === p.id);
    const reason = personReview?.reasonCategory ?? (!returned.length ? latest?.reviews[0]?.reasonCategory : null);
    const finalOutcome = latest?.reviews[0]?.outcome;
    const lastCorrectionAudit=latest && await db.auditEvent.findFirst({where:{OR:[{entityId:r.id,action:"APPROVAL_INVALIDATED"},{entityId:latest.id,action:"SUBMISSION_RETURNED"}]},orderBy:{occurredAt:"desc"},select:{action:true}});
    // Request/catalogue invalidation leaves unaffected ready workers locked;
    // it must not suppress a genuine AIA correction already returned to this person.
    if(!personReview && p.status==="LEADER_APPROVED" && (finalOutcome==="APPROVAL_INVALIDATED" || lastCorrectionAudit?.action==="APPROVAL_INVALIDATED")) return locked;
    if (personReview || (!returned.length && ["RETURNED_FOR_CORRECTION", "APPROVAL_INVALIDATED"].includes(finalOutcome ?? ""))) {
      fields = reason === "PHOTO" ? ["PHOTO"] : reason === "DOCUMENT" ? ["IDENTITY"] : reason === "WORK_DAYS" ? ["WORK_DAYS"] : ["ZONES", "VEHICLE_PASS"].includes(reason ?? "") ? [] : [...all];
    } else if (!latest && onboardingOpen(r, new Date()) && p.status !== "LEADER_APPROVED") fields = [...all];
  }
  const waitingForChange=grant?.status==="APPROVED" && !grant.fulfilledBySubmissionId && ((grant.type==="EDIT_PERSON" && p.version<=(grant.effectBaseVersion??p.version)) || (grant.type==="REPLACE_PHOTO" && p.photoObjectKey===grant.effectBasePhotoKey));
  return { editable: fields.length > 0, fields, canApprove: fields.length > 0 && !waitingForChange && p.status === "AWAITING_LEADER_REVIEW", canRemove: fields.length === all.length, canSaveDraft: fields.length === all.length && p.status === "DRAFT" };
}

export async function registrationCapabilities(db: Client, registrationId: string, role: "ADMIN" | "COMPANY_LEADER") {
  const r = await db.companyEventRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { company: true, event: true } });
  const locked = { zones: false, vehicle: false, add: false, submit: false, employeeLinks:false };
  if (r.withdrawnAt || r.erasedAt || r.company.deactivatedAt || ["DRAFT", "ARCHIVED"].includes(r.event.status) || !["DRAFT", "RETURNED_FOR_CORRECTION"].includes(r.status)) return locked;
  if (r.company.internalOrganisation) return role === "ADMIN" ? { ...locked, add: true, submit: true } : locked;
  if (r.status === "DRAFT" && onboardingOpen(r, new Date())) return { zones: true, vehicle: true, add: true, submit: true, employeeLinks:true };
  if (r.status !== "RETURNED_FOR_CORRECTION") return locked;
  const latest = await db.companySubmission.findFirst({ where: { registrationId }, orderBy: { version: "desc" }, include: { reviews: { orderBy: { createdAt: "desc" }, take: 1 }, participantReviews: true } });
  const review = latest?.reviews[0];
  const grant = await db.companyRequest.count({ where: { registrationId, status: "APPROVED", fulfilledBySubmissionId: null } });
  if (!review && !grant) return onboardingOpen(r, new Date()) ? { zones: true, vehicle: true, add: true, submit: true, employeeLinks:true } : locked;
  const returnedPeople = latest?.participantReviews.some(x => x.outcome === "RETURNED_FOR_CORRECTION");
  const add=!returnedPeople && ["HEADCOUNT", "PERSONNEL", "OTHER"].includes(review?.reasonCategory ?? "");
  return { zones: !returnedPeople && review?.reasonCategory === "ZONES", vehicle: !returnedPeople && review?.reasonCategory === "VEHICLE_PASS", add, employeeLinks:add && onboardingOpen(r,new Date()), submit: Boolean(grant || ["RETURNED_FOR_CORRECTION", "APPROVAL_INVALIDATED"].includes(review?.outcome ?? "")) };
}
