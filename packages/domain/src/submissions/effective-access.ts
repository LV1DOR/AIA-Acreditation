import { z } from "zod";
import type { PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireCompany, resolveActor } from "../auth/authorization.ts";
import { DomainError } from "../shared/errors.ts";
import { decryptSubmissionSnapshot } from "./snapshot-crypto.ts";

const zone=z.object({id:z.uuid(),name:z.string()});
const snapshotSchema=z.object({company:z.object({internalOrganisation:z.enum(["AIA","PARKALGAR"]).nullable().optional()}),zones:z.array(zone),participants:z.array(z.object({id:z.uuid(),version:z.number(),zones:z.array(zone).optional()}))});
export async function workerEffectiveAccess(db:PrismaClient,context:ActorContext,participantId:string,key:string) {
  const actor=await resolveActor(db,context);
  const p=await db.eventParticipant.findUnique({where:{id:z.uuid().parse(participantId)},include:{registration:{include:{company:true,zones:{include:{eventZone:{include:{zone:true}}}}}},individualZones:{include:{eventZone:{include:{zone:true}}}}}});
  if(!p) throw new DomainError("FORBIDDEN");
  await requireCompany(db,actor,p.registration.companyId);
  const internal=Boolean(p.registration.company.internalOrganisation);
  const requested=(internal?p.individualZones:p.registration.zones).map(x=>({id:x.zoneId,name:x.eventZone.zone.name}));
  const submissions=await db.companySubmission.findMany({where:{registrationId:p.registrationId},orderBy:{version:"desc"},include:{reviews:{orderBy:{createdAt:"desc"}}}});
  const history=[];
  for(const s of submissions) {
    if(!s.reviews.some(r=>r.outcome==="APPROVED")) continue;
    const snapshot=snapshotSchema.parse(decryptSubmissionSnapshot(s.snapshot,key,s.id));
    const person=snapshot.participants.find(x=>x.id===p.id);
    if(!person) continue;
    const zones=snapshot.company.internalOrganisation?person.zones??[]:snapshot.zones;
    history.push({submissionId:s.id,version:s.version,participantVersion:person.version,zones,currentlyApproved:s.reviews[0]?.outcome==="APPROVED"});
  }
  const latest=history.find(x=>x.submissionId===submissions[0]?.id);
  let effective:typeof requested=[];
  if(p.registration.status==="APPROVED" && p.status==="LEADER_APPROVED" && !p.registration.company.deactivatedAt && latest?.currentlyApproved && latest.participantVersion===p.version) {
    const matches=await db.eventZone.count({where:{eventId:p.eventId,zoneId:{in:latest.zones.map(x=>x.id)},deactivatedAt:null,zone:{deactivatedAt:null}}});
    if(matches===latest.zones.length) effective=latest.zones;
  }
  return {participantId:p.id,eventId:p.eventId,model:internal?"INDIVIDUAL" as const:"COMPANY" as const,requested,effective,history};
}
