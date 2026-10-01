import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.ts";
import { fixture } from "../fixtures/foundation.ts";
import { approveParticipant, cancelCompanyRequest, companyRequests, createCompanyRequest, decideCompanyRequest, markNotificationRead, markNotificationsRead, notificationOverview, pendingAdminRequests, submitCompanyRegistration, updateParticipantByLeader } from "../../packages/domain/src/index.ts";

const sensitiveKeys={encryptionKey:"11".repeat(32),fingerprintKey:"22".repeat(32)};

afterAll(() => db.$disconnect());

it("creates, authorises and approves an extra-personnel request atomically", async () => {
  const f=await fixture(db);
  const request=await createCompanyRequest(db,f.leaderActor,{ registrationId:f.registration.id, priority:"NORMAL", reason:"More accredited staff are required", payload:{ type:"EXTRA_PERSONNEL", additionalSlots:3 } });
  expect((await pendingAdminRequests(db,f.adminActor)).some(item=>item.id === request.id)).toBe(true);
  await decideCompanyRequest(db,f.adminActor,{ requestId:request.id, expectedVersion:1, decision:"APPROVE" });
  expect((await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).personnelLimit).toBe(13);
  expect(await db.auditEvent.count({where:{entityId:request.id,action:{in:["REQUEST_SUBMITTED","REQUEST_APPROVED"]}}})).toBe(2);
  expect(await db.notification.count({where:{recipientUserId:f.leader.id,type:"REQUEST_APPROVED"}})).toBe(1);
  const notification=(await notificationOverview(db,f.leaderActor)).find(item=>item.type==="REQUEST_APPROVED");
  expect(notification).toMatchObject({eventName:f.event.name,companyName:f.company.name,registrationId:f.registration.id,parameters:{requestId:request.id,requestType:"EXTRA_PERSONNEL"}});
});

it("marks only the selected notification read and supports an explicit mark-all action", async () => {
  const f=await fixture(db), other=await fixture(db);
  const [first,second,foreign]=await Promise.all([
    db.notification.create({data:{recipientUserId:f.leader.id,type:"REGISTRATION_UPDATED",parameters:{},deduplicationKey:`read-first-${randomUUID()}`}}),
    db.notification.create({data:{recipientUserId:f.leader.id,type:"DEADLINE_REMINDER",parameters:{},deduplicationKey:`read-second-${randomUUID()}`}}),
    db.notification.create({data:{recipientUserId:other.leader.id,type:"REGISTRATION_UPDATED",parameters:{},deduplicationKey:`read-foreign-${randomUUID()}`}}),
  ]);
  await markNotificationRead(db,f.leaderActor,first.id);
  expect((await db.notification.findUniqueOrThrow({where:{id:first.id}})).readAt).not.toBeNull();
  expect((await db.notification.findUniqueOrThrow({where:{id:second.id}})).readAt).toBeNull();
  await markNotificationRead(db,f.leaderActor,foreign.id);
  expect((await db.notification.findUniqueOrThrow({where:{id:foreign.id}})).readAt).toBeNull();
  await markNotificationsRead(db,f.leaderActor);
  expect((await db.notification.findUniqueOrThrow({where:{id:second.id}})).readAt).not.toBeNull();
});

it("allows only the owning leader to cancel a pending request", async () => {
  const f=await fixture(db), other=await fixture(db);
  const request=await createCompanyRequest(db,f.leaderActor,{ registrationId:f.registration.id, reason:"Operational exception requires review", payload:{type:"OTHER"} });
  await expect(cancelCompanyRequest(db,other.leaderActor,request.id,1)).rejects.toThrow("FORBIDDEN");
  const cancelled=await cancelCompanyRequest(db,f.leaderActor,request.id,1);
  expect(cancelled.status).toBe("CANCELLED");
  expect((await companyRequests(db,f.leaderActor,f.registration.id))[0]?.status).toBe("CANCELLED");
});

it("requires a rejection comment and prevents concurrent second decisions", async () => {
  const f=await fixture(db);
  const request=await createCompanyRequest(db,f.leaderActor,{ registrationId:f.registration.id, priority:"URGENT", reason:"Decision is needed before the event", payload:{type:"OTHER"} });
  await expect(decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"REJECT"})).rejects.toThrow("INVALID_INPUT");
  await decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"REJECT",comment:"Not operationally justified"});
  await expect(decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"APPROVE"})).rejects.toThrow("STALE_WRITE");
});

it("approves an emergency replacement without consuming another personnel slot", async () => {
  const f=await fixture(db);
  const original=await db.eventParticipant.create({data:{registrationId:f.registration.id,eventId:f.event.id,fullName:"Original person",status:"LEADER_APPROVED"}});
  await db.companyEventRegistration.update({where:{id:f.registration.id},data:{status:"APPROVED"}});
  const request=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,targetParticipantId:original.id,priority:"URGENT",reason:"The accredited person is no longer available",payload:{type:"REPLACE_PERSON",replacementName:"Replacement person"}});
  await decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"APPROVE"});
  const [registration,oldPerson,replacement]=await Promise.all([
    db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}}),
    db.eventParticipant.findUniqueOrThrow({where:{id:original.id}}),
    db.eventParticipant.findUniqueOrThrow({where:{replacementRequestId:request.id}}),
  ]);
  expect(registration.personnelLimit).toBe(10);
  expect(registration.status).toBe("RETURNED_FOR_CORRECTION");
  expect(oldPerson.status).toBe("REPLACED");
  expect(replacement).toMatchObject({fullName:"Replacement person",status:"DRAFT",registrationId:f.registration.id});
  expect(await db.eventParticipant.count({where:{registrationId:f.registration.id,status:{notIn:["REMOVED","REPLACED"]}}})).toBe(1);
});

it("applies a zone-change request from the selected event-zone checklist", async () => {
  const f=await fixture(db);
  const [first,second]=await Promise.all([
    db.zone.create({data:{name:"Paddock " + randomUUID()}}),
    db.zone.create({data:{name:"Media " + randomUUID()}}),
  ]);
  await db.eventZone.createMany({data:[{eventId:f.event.id,zoneId:first.id},{eventId:f.event.id,zoneId:second.id}]});
  await db.companyZoneRequest.create({data:{registrationId:f.registration.id,eventId:f.event.id,zoneId:first.id}});
  const request=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,reason:"The operating footprint has changed",payload:{type:"ZONE_CHANGE",zoneIds:[second.id]}});
  await decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"APPROVE"});
  expect(await db.companyZoneRequest.findMany({where:{registrationId:f.registration.id},select:{zoneId:true}})).toEqual([{zoneId:second.id}]);
});

it("lets a leader complete an approved emergency replacement after the deadline and resubmit it for normal AIA review", async () => {
  const f=await fixture(db);
  const role=await db.jobRole.create({data:{name:"Replacement role " + randomUUID()}});
  const original=await db.eventParticipant.create({data:{registrationId:f.registration.id,eventId:f.event.id,fullName:"Unavailable person",status:"LEADER_APPROVED"}});
  await db.companyEventRegistration.update({where:{id:f.registration.id},data:{status:"APPROVED"}});
  await db.event.update({where:{id:f.event.id},data:{onboardingClosesAt:new Date(Date.now()-60_000)}});
  const request=await createCompanyRequest(db,f.leaderActor,{registrationId:f.registration.id,targetParticipantId:original.id,priority:"URGENT",reason:"Emergency replacement required for operations",payload:{type:"REPLACE_PERSON",replacementName:"Ready replacement"}});
  await decideCompanyRequest(db,f.adminActor,{requestId:request.id,expectedVersion:1,decision:"APPROVE"});
  const replacement=await db.eventParticipant.findUniqueOrThrow({where:{replacementRequestId:request.id}});
  await updateParticipantByLeader(db,f.leaderActor,replacement.id,{fullName:"Ready replacement",dateOfBirth:"1990-01-01",documentType:"PASSPORT",documentNumber:"P1234567",documentExpiryDate:"2030-01-01",mobile:"+351912345678",nationalityCode:"PT",jobRoleId:role.id,workDays:["2026-10-01"],privacyAcknowledged:true,privacyNoticeVersion:"test-v1"},sensitiveKeys,"photos/replacement.jpg");
  await approveParticipant(db,f.leaderActor,replacement.id);
  const registration=await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}});
  const submission=await submitCompanyRegistration(db,f.leaderActor,{registrationId:f.registration.id,expectedVersion:registration.version},sensitiveKeys.encryptionKey);
  expect((await db.companyRequest.findUniqueOrThrow({where:{id:request.id}})).fulfilledBySubmissionId).toBe(submission.id);
  expect((await db.companyEventRegistration.findUniqueOrThrow({where:{id:f.registration.id}})).status).toBe("AIA_REVIEW");
});
