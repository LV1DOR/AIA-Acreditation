import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { syntheticPhoto, readyPerson, readyConfiguration } from "../fixtures/security.ts";
import { ensureInternalRegistration, previewInternalImport, commitInternalImport, downloadInternalTemplate, updateInternalWorkerZones, updateParticipantByLeader, approveParticipant, submitCompanyRegistration, reviewSubmissionParticipant, reviewCompanySubmission, workerEffectiveAccess, leaderRegistration, issueLeaderInvitation, updatePersonnelLimit, zones, internalWorkerHistory, issueEmployeeInvitation } from "../../packages/domain/src/index.ts";
import { importHeaders } from "../../packages/domain/src/internal/spreadsheet.ts";
const keys={encryptionKey:"11".repeat(32),fingerprintKey:"22".repeat(32)},consent={dataProcessingAccepted:true as const,dataProcessingNoticeVersion:"test-v1"};
afterAll(()=>db.$disconnect());
async function setup() {
  const f=await fixture(db);
  const r=await ensureInternalRegistration(db,f.adminActor,{eventId:f.event.id,organisation:"AIA",personnelLimit:1000});
  const role=await db.jobRole.create({data:{name:"Internal synthetic "+randomUUID()}});
  const zs=[];for(const name of ["PADDOCK","MEDIA","GRANDSTAND"]) {const z=await db.zone.create({data:{name:name+randomUUID()}});await db.eventZone.create({data:{eventId:f.event.id,zoneId:z.id}});zs.push(z);}
  return {...f,r,role,zs};
}
const csv=(rows:string[][])=>Buffer.from(importHeaders.map(x=>'"'+x+'"').join(",")+"\n"+rows.map(row=>row.map(x=>'"'+x.replaceAll('"','""')+'"').join(",")).join("\n"));
function row(f:Awaited<ReturnType<typeof setup>>,name:string,ref:string,zoneIds:string[],doc:string=randomUUID()) {return [name,"1990-01-01","PASSPORT",doc,"2035-01-01","+351912345678","PT","AIA",f.role.id,"2026-10-01;2026-10-02",zoneIds.join(";"),ref+".jpg",ref];}
async function commit(f:Awaited<ReturnType<typeof setup>>,bytes:Buffer) {const p=await previewInternalImport(db,f.adminActor,f.r.id,bytes,"workers.csv",keys);return commitInternalImport(db,f.adminActor,{registrationId:f.r.id,expectedVersion:p.expectedVersion,fileHash:p.fileHash,confirmed:true},bytes,"workers.csv",keys);}
async function approveRegistration(f:Awaited<ReturnType<typeof setup>>,id:string,actor=f.adminActor) {
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id}});
  const s=await submitCompanyRegistration(db,actor,{registrationId:id,expectedVersion:r.version,...consent},keys.encryptionKey);
  const people=await db.eventParticipant.findMany({where:{registrationId:id,status:{notIn:["REMOVED","REPLACED"]}}});
  for(const p of people) await reviewSubmissionParticipant(db,f.adminActor,{submissionId:s.id,participantId:p.id,outcome:"APPROVED"});
  const current=await db.companyEventRegistration.findUniqueOrThrow({where:{id}});
  await reviewCompanySubmission(db,f.adminActor,{submissionId:s.id,expectedRegistrationVersion:current.version,action:"APPROVE"});return s;
}
it("imports two internal workers, completes photos, reviews and proves individual vs external effective zone isolation",async()=>{
  const f=await setup(),bytes=csv([row(f,"Synthetic A","A",[f.zs[0]!.id,f.zs[1]!.id]),row(f,"Synthetic B","B",[f.zs[2]!.id])]);
  const preview=await previewInternalImport(db,f.adminActor,f.r.id,bytes,"workers.csv",keys);
  expect(preview).toMatchObject({total:2,incomplete:2,valid:0,invalid:0,create:2,zoneAssignments:3});
  expect(preview.rows[0]?.missing).toContain("Fotografia / Photograph");
  expect((await downloadInternalTemplate(db,f.adminActor,f.r.id)).subarray(0,2).toString()).toBe("PK");
  await commit(f,bytes);
  let people=await db.eventParticipant.findMany({where:{registrationId:f.r.id},orderBy:{fullName:"asc"}});
  expect(people.map(p=>p.status)).toEqual(["DRAFT","DRAFT"]);
  expect(people[0]?.documentNumberCiphertext).toBeTruthy();
  await expect(submitCompanyRegistration(db,f.adminActor,{registrationId:f.r.id,expectedVersion:2,...consent},keys.encryptionKey)).rejects.toThrow("SUBMISSION_INCOMPLETE");
  for(const p of people) {
    await updateParticipantByLeader(db,f.adminActor,p.id,{fullName:p.fullName!,dateOfBirth:"1990-01-01",documentType:"PASSPORT",documentExpiryDate:"2035-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:f.role.id,workDays:["2026-10-01","2026-10-02"],privacyAcknowledged:true,privacyNoticeVersion:"test-v1"},keys,await syntheticPhoto(db,p.id));
    await approveParticipant(db,f.adminActor,p.id);
  }
  const s=await approveRegistration(f,f.r.id);
  const [a,b]=await Promise.all(people.map(p=>workerEffectiveAccess(db,f.adminActor,p.id,keys.encryptionKey)));
  expect(a?.effective.map(z=>z.id).sort()).toEqual([f.zs[0]!.id,f.zs[1]!.id].sort());expect(b?.effective.map(z=>z.id)).toEqual([f.zs[2]!.id]);
  const externalZone=await readyConfiguration(db,f);
  const extA=await readyPerson(db,f,"External A",keys.encryptionKey),extB=await readyPerson(db,f,"External B",keys.encryptionKey);
  await approveRegistration(f,f.registration.id,f.leaderActor);
  for(const p of [extA,extB]) expect((await workerEffectiveAccess(db,f.leaderActor,p.id,keys.encryptionKey)).effective.map(z=>z.id)).toEqual([externalZone.id]);
  const p=await db.eventParticipant.findUniqueOrThrow({where:{id:people[1]!.id}});
  await updateInternalWorkerZones(db,f.adminActor,{participantId:p.id,expectedVersion:p.version,zoneIds:[f.zs[1]!.id],reason:"Synthetic authorised zone correction"});
  const after=await workerEffectiveAccess(db,f.adminActor,p.id,keys.encryptionKey);
  expect(after.effective).toEqual([]);expect(after.requested.map(z=>z.id)).toEqual([f.zs[1]!.id]);expect(after.history[0]).toMatchObject({submissionId:s.id,zones:[{id:f.zs[2]!.id}]});
  const history=await internalWorkerHistory(db,f.adminActor,p.id);
  expect(history.find(x=>x.action==="INTERNAL_ZONES_UPDATED")).toMatchObject({reason:"Synthetic authorised zone correction",previousZones:[f.zs[2]!.name],zones:[f.zs[1]!.name]});
  await expect(internalWorkerHistory(db,f.leaderActor,p.id)).rejects.toThrow("FORBIDDEN");
  await expect(issueEmployeeInvitation(db,f.adminActor,p.id,new Date(Date.now()+60000))).rejects.toThrow("FORBIDDEN");
  expect((await workerEffectiveAccess(db,f.adminActor,people[0]!.id,keys.encryptionKey)).effective).toEqual([]);
  people=await db.eventParticipant.findMany({where:{registrationId:f.r.id}});expect(people.find(p=>p.id===after.participantId)?.status).toBe("AWAITING_LEADER_REVIEW");
});
it("enforces organisation identity and both zone assignment models at database and domain boundaries",async()=>{
  const f=await setup();await db.company.update({where:{id:f.company.id},data:{name:"AIA"}});
  await expect(previewInternalImport(db,f.leaderActor,f.r.id,csv([row(f,"Synthetic","x",[])]),"workers.csv",keys)).rejects.toThrow("FORBIDDEN");
  await expect(previewInternalImport(db,f.adminActor,f.registration.id,csv([row(f,"Synthetic","x",[])]),"workers.csv",keys)).rejects.toThrow("FORBIDDEN");
  await expect(issueLeaderInvitation(db,f.adminActor,{registrationId:f.r.id,email:"synthetic@example.com",expiresAt:new Date(Date.now()+60000)})).rejects.toThrow("INVALID_INPUT");
  await expect(leaderRegistration(db,f.leaderActor,f.r.id,keys.encryptionKey)).rejects.toThrow("FORBIDDEN");
  const external=await db.eventParticipant.create({data:{registrationId:f.registration.id,eventId:f.event.id}});
  await expect(db.participantZoneRequest.create({data:{participantId:external.id,eventId:f.event.id,zoneId:f.zs[0]!.id}})).rejects.toThrow();
  await expect(db.companyZoneRequest.create({data:{registrationId:f.r.id,eventId:f.event.id,zoneId:f.zs[0]!.id}})).rejects.toThrow();
  await expect(db.company.update({where:{id:f.company.id},data:{internalOrganisation:"PARKALGAR"}})).rejects.toThrow();
  await expect(db.companyEventRegistration.update({where:{id:f.r.id},data:{companyId:f.company.id}})).rejects.toThrow();
  await commit(f,csv([row(f,"Synthetic Internal","a",[f.zs[0]!.id])]));const p=await db.eventParticipant.findFirstOrThrow({where:{registrationId:f.r.id}});
  await expect(db.participantZoneRequest.create({data:{participantId:p.id,eventId:(await fixture(db)).event.id,zoneId:f.zs[0]!.id}})).rejects.toThrow();
});
it("retries and concurrent imports are idempotent; a changed file skips existing identities/references",async()=>{
  const f=await setup(),bytes=csv([row(f,"Synthetic Retry","retry",[f.zs[0]!.id])]);
  const preview=await previewInternalImport(db,f.adminActor,f.r.id,bytes,"workers.csv",keys),input={registrationId:f.r.id,fileHash:preview.fileHash,expectedVersion:preview.expectedVersion,confirmed:true as const};
  const results=await Promise.all([commitInternalImport(db,f.adminActor,input,bytes,"workers.csv",keys),commitInternalImport(db,f.adminActor,input,bytes,"workers.csv",keys)]);
  expect(results.filter(x=>x.replayed)).toHaveLength(1);expect(await db.eventParticipant.count({where:{registrationId:f.r.id}})).toBe(1);
  const changed=csv([row(f,"Different name","retry",[f.zs[1]!.id])]);
  expect(await previewInternalImport(db,f.adminActor,f.r.id,changed,"workers.csv",keys)).toMatchObject({create:0,skip:1,update:0});
});
it("reports invalid/incomplete rows, rejects stale catalogs on confirmation and preserves transactional capacity",async()=>{
  const f=await setup(),missing=row(f,"Missing Fields","missing",[]);missing[1]="";missing[3]="";missing[5]="";missing[8]="";missing[9]="";
  const bad=row(f,"Bad Zones","bad",[f.zs[0]!.id,f.zs[0]!.id]),foreign=row(f,"Wrong Org","org",[f.zs[0]!.id]);foreign[7]="PARKALGAR";
  const preview=await previewInternalImport(db,f.adminActor,f.r.id,csv([missing,bad,foreign]),"workers.csv",keys);
  expect(preview).toMatchObject({incomplete:1,invalid:2,create:1});
  await commit(f,csv([missing,bad,foreign]));const p=await db.eventParticipant.findFirstOrThrow({where:{registrationId:f.r.id}});expect(p.dateOfBirth).toBeNull();expect(await db.participantZoneRequest.count({where:{participantId:p.id}})).toBe(0);
  const bytes=csv([row(f,"Inactive","inactive",[f.zs[1]!.id])]),pre=await previewInternalImport(db,f.adminActor,f.r.id,bytes,"workers.csv",keys);
  await db.eventZone.update({where:{eventId_zoneId:{eventId:f.event.id,zoneId:f.zs[1]!.id}},data:{deactivatedAt:new Date()}});
  const committed=await commitInternalImport(db,f.adminActor,{registrationId:f.r.id,expectedVersion:pre.expectedVersion,fileHash:pre.fileHash,confirmed:true},bytes,"workers.csv",keys);
  expect(committed.createdCount).toBe(0);expect(committed.skippedCount).toBe(1);
  const current=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.r.id}});await updatePersonnelLimit(db,f.adminActor,{registrationId:f.r.id,expectedVersion:current.version,personnelLimit:1});
  await expect(commit(f,csv([row(f,"Beyond capacity","limit",[f.zs[0]!.id])]))).rejects.toThrow("PERSONNEL_LIMIT_REACHED");expect(await db.eventParticipant.count({where:{registrationId:f.r.id}})).toBe(1);
});
it("imports more than ten workers without changing external capacity and guards zone deactivation",async()=>{
  const f=await setup(),bytes=csv(Array.from({length:120},(_,i)=>row(f,"Synthetic Large "+i,"L"+i,[f.zs[i%3]!.id])));
  expect((await commit(f,bytes)).createdCount).toBe(120);expect((await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).personnelLimit).toBe(10);
  await expect(zones.update(db,f.adminActor,{id:f.zs[0]!.id,name:f.zs[0]!.name,expectedVersion:1,active:false})).rejects.toThrow("ZONE_IN_USE");
});
it("flags duplicate identities without approving them or logging raw document numbers",async()=>{
  const f=await setup(),doc="SYNTHETIC"+randomUUID(),bytes=csv([row(f,"Duplicate A","DA",[f.zs[0]!.id],doc),row(f,"Duplicate B","DB",[f.zs[1]!.id],doc)]);
  const preview=await previewInternalImport(db,f.adminActor,f.r.id,bytes,"workers.csv",keys);expect(preview.duplicates).toBe(1);
  const batch=await commit(f,bytes);expect(await db.eventParticipant.count({where:{registrationId:f.r.id,status:"DUPLICATE_REVIEW_REQUIRED"}})).toBe(1);
  expect(JSON.stringify(await db.auditEvent.findMany({where:{entityId:batch.id}}))).not.toContain(doc);
});
it("reports invalid document type, expiry, phone, nationality and duplicated working dates",async()=>{
  const f=await setup(),invalidType=row(f,"Invalid type","type",[f.zs[0]!.id]),expired=row(f,"Expired document","expiry",[f.zs[0]!.id]),phone=row(f,"Invalid phone","phone",[f.zs[0]!.id]),country=row(f,"Unknown nationality","country",[f.zs[0]!.id]),days=row(f,"Duplicate days","days",[f.zs[0]!.id]);
  invalidType[2]="UNKNOWN";expired[4]="2026-10-02";phone[5]="not-a-phone";country[6]="ZZ";days[9]="2026-10-01;2026-10-01";
  const preview=await previewInternalImport(db,f.adminActor,f.r.id,csv([invalidType,expired,phone,country,days]),"workers.csv",keys);
  expect(preview.invalid).toBe(5);expect(preview.create).toBe(0);
});
