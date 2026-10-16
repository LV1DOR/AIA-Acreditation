import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { readyPerson, readyConfiguration, syntheticPhoto } from "../fixtures/security.ts";
import { createCompanyRequest, decideCompanyRequest, participantCapabilities, registrationCapabilities, approveParticipant, updateParticipantByLeader, submitCompanyRegistration, reviewCompanySubmission, reviewSubmissionParticipant, configureRegistration, manageLeaderMembership, assignPrimaryLeader, leaderRegistration, issueLeaderInvitation, acceptLeaderInvitation, reinstateRemovedParticipant, employeeInvitationView, createParticipantWithInvitation, createParticipant, issueEmployeeInvitation, removeParticipant, reopenApprovedRegistration } from "../../packages/domain/src/index.ts";
const keys={encryptionKey:"1".repeat(64),fingerprintKey:"2".repeat(64)},consent={dataProcessingAccepted:true as const,dataProcessingNoticeVersion:"test-v1"};
afterAll(()=>db.$disconnect());
async function setup() {
  const f=await fixture(db),zone=await readyConfiguration(db,f),p=await readyPerson(db,f);
  const s=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:1,...consent},keys.encryptionKey);
  await reviewSubmissionParticipant(db,f.adminActor,{submissionId:s.id,participantId:p.id,outcome:"APPROVED"});
  await reviewCompanySubmission(db,f.adminActor,{submissionId:s.id,expectedRegistrationVersion:2,action:"APPROVE"});
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()-1000)}});
  return {...f,zone,p,s};
}
const details=(p:{fullName:string|null;jobRoleId:string|null})=>({fullName:p.fullName!,dateOfBirth:"1990-01-01",documentType:"PASSPORT" as const,documentExpiryDate:"2035-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:p.jobRoleId!,workDays:["2026-10-01"]});
it.each(["EDIT_PERSON","REPLACE_PHOTO"] as const)("F11 %s grants scoped completion after deadline and requires an actual correction before readiness",async type=>{
  const f=await setup(),request=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,targetParticipantId:f.p.id,reason:"Synthetic correction after deadline",payload:type==="EDIT_PERSON"?{type,scope:"CONTACT"}:{type}});
  await decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"APPROVE"});
  const caps=await participantCapabilities(db,f.p.id,"COMPANY_LEADER");expect(caps.fields).toEqual(type==="EDIT_PERSON"?["CONTACT"]:["PHOTO"]);
  expect(caps.canApprove).toBe(false);
  await expect(issueEmployeeInvitation(db,f.leaderActor,f.p.id,new Date(Date.now()+60000))).rejects.toThrow("EDIT_LOCKED");
  await expect(approveParticipant(db,f.leaderActor,f.p.id)).rejects.toThrow("SUBMISSION_INCOMPLETE");
  await expect(updateParticipantByLeader(db,f.leaderActor,f.p.id,{...details(f.p),fullName:"Crafted identity change"},keys)).rejects.toThrow("EDIT_LOCKED");
  const current=await db.eventParticipant.findUniqueOrThrow({where:{id:f.p.id}});
  await expect(updateParticipantByLeader(db,f.leaderActor,f.p.id,details(f.p),keys,undefined,current.version-1)).rejects.toThrow("STALE_WRITE");
  await expect(updateParticipantByLeader(db,f.leaderActor,f.p.id,{...details(f.p),privacyAcknowledged:true,privacyNoticeVersion:"crafted-notice"},keys)).rejects.toThrow("EDIT_LOCKED");
  await updateParticipantByLeader(db,f.leaderActor,f.p.id,{...details(f.p),...(type==="EDIT_PERSON"?{mobile:"+351912345679"}:{}),privacyAcknowledged:true,privacyNoticeVersion:current.privacyNoticeVersion!},keys,type==="REPLACE_PHOTO"?await syntheticPhoto(db,f.p.id):undefined,current.version);
  expect((await db.eventParticipant.findUniqueOrThrow({where:{id:f.p.id}})).privacyAcknowledgedAt).toEqual(current.privacyAcknowledgedAt);
  await approveParticipant(db,f.leaderActor,f.p.id);
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});
  const s=await submitCompanyRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:r.version,...consent},keys.encryptionKey);
  expect(s.version).toBe(2);expect((await db.companyRequest.findUniqueOrThrow({where:{id:request.id}})).fulfilledBySubmissionId).toBe(s.id);
  expect((await participantCapabilities(db,f.p.id,"COMPANY_LEADER")).editable).toBe(false);
});
it("F11 ADD_AFTER_DEADLINE creates completable scoped drafts and leaves unrelated workers locked",async()=>{
  const f=await setup(),req=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,reason:"Synthetic additional late personnel",payload:{type:"ADD_AFTER_DEADLINE",count:2}});
  await decideCompanyRequest(db,f.adminActor,{requestId:req.id,expectedVersion:1,decision:"APPROVE"});
  expect((await participantCapabilities(db,f.p.id,"COMPANY_LEADER")).editable).toBe(false);
  const added=await db.eventParticipant.findMany({where:{registrationId:f.registration.id,editRequestId:req.id}});expect(added).toHaveLength(2);
  for(const p of added) {
    expect((await participantCapabilities(db,p.id,"COMPANY_LEADER")).editable).toBe(true);
    await updateParticipantByLeader(db,f.leaderActor,p.id,{...details(f.p),fullName:"Synthetic added "+p.id,documentNumber:randomUUID(),privacyAcknowledged:true,privacyNoticeVersion:"test-v1"},keys,await syntheticPhoto(db,p.id));await approveParticipant(db,f.leaderActor,p.id);
  }
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});expect((await submitCompanyRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:r.version,...consent},keys.encryptionKey)).version).toBe(2);
});
it.each(["ZONES","VEHICLE_PASS"] as const)("F10 returned %s configuration can be corrected after deadline without unlocking worker identity",async reason=>{
  const f=await setup();
  // Reopen before deadline, then return a new review after deadline.
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()+60000)}});
  await reopenApprovedRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:3});
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});
  const s=await submitCompanyRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:r.version,...consent},keys.encryptionKey);
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()-1000)}});
  const cur=await db.companyEventRegistration.findUniqueOrThrow({where:{id:r.id}});
  await reviewCompanySubmission(db,f.adminActor,{submissionId:s.id,expectedRegistrationVersion:cur.version,action:"RETURN",reason,comment:"Synthetic company-level correction instructions"});
  const caps=await registrationCapabilities(db,r.id,"COMPANY_LEADER");expect(caps.zones).toBe(reason==="ZONES");expect(caps.vehicle).toBe(reason==="VEHICLE_PASS");expect(caps.submit).toBe(true);
  expect((await participantCapabilities(db,f.p.id,"COMPANY_LEADER")).editable).toBe(false);
  const second=await db.zone.create({data:{name:"Correction "+randomUUID()}});await db.eventZone.create({data:{eventId:f.event.id,zoneId:second.id}});
  const current=await db.companyEventRegistration.findUniqueOrThrow({where:{id:r.id}});
  await configureRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:current.version,zoneIds:reason==="ZONES"?[second.id]:[f.zone.id],vehicle:reason==="VEHICLE_PASS"?{required:true,requestedQuantity:1,justification:"Synthetic justified vehicle"}:{required:false,requestedQuantity:0,justification:null}});
  const next=await db.companyEventRegistration.findUniqueOrThrow({where:{id:r.id}});expect((await submitCompanyRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:next.version,...consent},keys.encryptionKey)).version).toBe(3);
});
it("F13 revocation isolates a company, clears primary assignment, invalidates pending invites and preserves secondary leaders",async()=>{
  const f=await fixture(db),other=await fixture(db);
  const secondary=await db.companyLeaderMembership.create({data:{companyId:f.company.id,userId:other.leader.id}});
  await db.companyLeaderMembership.create({data:{companyId:other.company.id,userId:f.leader.id}});
  const invitation=await issueLeaderInvitation(db,f.adminActor,{registrationId:f.registration.id,email:"synthetic-revoked@example.com",expiresAt:new Date(Date.now()+60000)});
  await expect(manageLeaderMembership(db,f.leaderActor,{membershipId:f.membership.id,expectedVersion:1,action:"REVOKE",reason:"Synthetic controlled revocation"})).rejects.toThrow("FORBIDDEN");
  await manageLeaderMembership(db,f.adminActor,{membershipId:f.membership.id,expectedVersion:1,action:"REVOKE",reason:"Synthetic controlled revocation"});
  await expect(leaderRegistration(db,f.leaderActor,f.registration.id,keys.encryptionKey)).rejects.toThrow("FORBIDDEN");
  expect((await db.companyLeaderMembership.findUniqueOrThrow({where:{id:secondary.id}})).revokedAt).toBeNull();
  expect((await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).primaryLeaderMembershipId).toBeNull();
  await expect(acceptLeaderInvitation(db,{clerkUserId:f.leader.clerkUserId,correlationId:randomUUID(),verifiedEmails:["synthetic-revoked@example.com"]},invitation.token)).rejects.toThrow("INVITATION_UNAVAILABLE");
  const fresh=await issueLeaderInvitation(db,f.adminActor,{registrationId:f.registration.id,email:"synthetic-revoked@example.com",expiresAt:new Date(Date.now()+60000)});
  await expect(acceptLeaderInvitation(db,{clerkUserId:f.leader.clerkUserId,correlationId:randomUUID(),verifiedEmails:["synthetic-revoked@example.com"]},fresh.token)).rejects.toThrow("INVITATION_UNAVAILABLE");
  await expect(leaderRegistration(db,f.leaderActor,other.registration.id,keys.encryptionKey)).resolves.toBeTruthy();
  const current=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});
  await assignPrimaryLeader(db,f.adminActor,{registrationId:f.registration.id,membershipId:secondary.id,expectedVersion:current.version,reason:"Synthetic primary replacement"});
  await manageLeaderMembership(db,f.adminActor,{membershipId:f.membership.id,expectedVersion:2,action:"RESTORE",reason:"Synthetic explicit restoration"});
  expect((await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).primaryLeaderMembershipId).toBe(secondary.id);
  expect(await db.auditEvent.count({where:{entityId:f.membership.id,action:{in:["MEMBERSHIP_REVOKED","MEMBERSHIP_RESTORED"]}}})).toBe(2);
});
it("F34 controlled reinstatement starts a draft with a new grant, preserves old link revocation and refuses replaced workers",async()=>{
  const f=await fixture(db),link=await createParticipantWithInvitation(db,f.leaderActor,f.registration.id,new Date(Date.now()+60000));
  await removeParticipant(db,f.leaderActor,link.participantId);
  const p=await db.eventParticipant.findUniqueOrThrow({where:{id:link.participantId}});
  await expect(reinstateRemovedParticipant(db,f.leaderActor,{participantId:p.id,expectedVersion:p.version,reason:"Synthetic reinstatement"})).rejects.toThrow("FORBIDDEN");
  await reinstateRemovedParticipant(db,f.adminActor,{participantId:p.id,expectedVersion:p.version,reason:"Synthetic reinstatement"});
  expect((await db.eventParticipant.findUniqueOrThrow({where:{id:p.id}})).status).toBe("DRAFT");
  await expect(employeeInvitationView(db,link.token)).rejects.toThrow("TOKEN_UNAVAILABLE");
  await db.eventParticipant.update({where:{id:p.id},data:{status:"REPLACED"}});
  await expect(reinstateRemovedParticipant(db,f.adminActor,{participantId:p.id,expectedVersion:p.version+1,reason:"Synthetic forbidden resurrection"})).rejects.toThrow("EDIT_LOCKED");
});
it("F11 rejects a narrow correction grant when missing unrelated fields would make completion impossible",async()=>{
  const f=await fixture(db),p=await db.eventParticipant.create({data:{registrationId:f.registration.id,eventId:f.event.id,fullName:"Incomplete synthetic"}});
  const req=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,targetParticipantId:p.id,reason:"Synthetic incomplete contact correction",payload:{type:"EDIT_PERSON",scope:"CONTACT"}});
  await expect(decideCompanyRequest(db,f.adminActor,{requestId:req.id,expectedVersion:1,decision:"APPROVE"})).rejects.toThrow("SUBMISSION_INCOMPLETE");
  expect((await db.companyRequest.findUniqueOrThrow({where:{id:req.id}})).status).toBe("PENDING");expect((await db.eventParticipant.findUniqueOrThrow({where:{id:p.id}})).editRequestId).toBeNull();
});
it("F10 an extra-capacity approval does not lock a genuine post-deadline headcount correction or its new drafts",async()=>{
  const f=await setup();
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()+60000)}});
  await reopenApprovedRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:3});
  const s=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:4,...consent},keys.encryptionKey);
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()-1000)}});
  await reviewCompanySubmission(db,f.adminActor,{submissionId:s.id,expectedRegistrationVersion:5,action:"RETURN",reason:"HEADCOUNT",comment:"Synthetic genuine headcount correction"});
  const req=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,reason:"Synthetic additional capacity for correction",payload:{type:"EXTRA_PERSONNEL",additionalSlots:2}});
  await decideCompanyRequest(db,f.adminActor,{requestId:req.id,expectedVersion:1,decision:"APPROVE"});
  const p=await createParticipant(db,f.leaderActor,f.registration.id);
  expect((await participantCapabilities(db,p.id,"COMPANY_LEADER")).editable).toBe(true);
  await updateParticipantByLeader(db,f.leaderActor,p.id,{...details(f.p),fullName:"New correction worker",documentNumber:randomUUID(),privacyAcknowledged:true,privacyNoticeVersion:"test-v1"},keys,await syntheticPhoto(db,p.id));
  await approveParticipant(db,f.leaderActor,p.id);
  const r=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});
  expect((await submitCompanyRegistration(db,f.leaderActor,{registrationId:r.id,expectedVersion:r.version,...consent},keys.encryptionKey)).version).toBe(3);
});
