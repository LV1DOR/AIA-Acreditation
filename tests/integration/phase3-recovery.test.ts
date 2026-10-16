import {afterAll,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {db} from "./database.ts";
import {fixture} from "../fixtures/foundation.ts";
import {transaction} from "../../packages/domain/src/shared/transaction.ts";
import {claimDelivery,reconcileExpiredDeliveryLeases,recoverDelivery,finishDeliveryFailure,queueBusinessEmail,deliverNextBusinessEmail,enqueueAuthEmail,deliverNextAuthEmail,adminOperationalSignals} from "../../packages/domain/src/index.ts";
afterAll(()=>db.$disconnect());
async function message(attempts=0){const f=await fixture(db),deduplicationKey='phase3-recovery:'+randomUUID();await transaction(db,tx=>queueBusinessEmail(tx,deduplicationKey,{registrationId:f.registration.id,recipientUserId:f.leader.id,template:'SUBMISSION_APPROVED',companyName:f.company.name,eventName:f.event.name,path:'/portal'}));const m=await db.outboxMessage.update({where:{deduplicationKey},data:{attempts,availableAt:new Date(0)}});return {f,m};}
it('F17 a crash at the final claim becomes uncertain, scrubs payload and can reissue only a current authorised portal update',async()=>{
  const {f,m}=await message(7),owner=randomUUID();const claimed=await transaction(db,tx=>claimDelivery(tx,['BUSINESS_EMAIL'],8,owner,new Date()));expect(claimed?.id).toBe(m.id);
  expect((await db.outboxMessage.findUniqueOrThrow({where:{id:m.id}})).attempts).toBe(8);
  await db.outboxMessage.update({where:{id:m.id},data:{leaseExpiresAt:new Date(0)}});await reconcileExpiredDeliveryLeases(db);
  const terminal=await db.outboxMessage.findUniqueOrThrow({where:{id:m.id}});expect(terminal).toMatchObject({payload:{},lastFailureCode:'FINAL_LEASE_EXPIRED_UNCERTAIN',leaseOwner:null});expect(terminal.terminalAt).not.toBeNull();
  expect((await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:m.id}})).status).toBe('UNKNOWN');
  await expect(recoverDelivery(db,f.leaderActor,m.id,'SYNTHETIC-OPERATOR')).rejects.toThrow('FORBIDDEN');
  const recovered=await recoverDelivery(db,f.adminActor,m.id,'SYNTHETIC-OPERATOR');const next=await db.outboxMessage.findUniqueOrThrow({where:{id:recovered.id}});expect(next.payload).toMatchObject({template:'STATUS_UPDATE'});expect(JSON.stringify(next.payload)).not.toContain('SUBMISSION_APPROVED');
  await db.outboxMessage.update({where:{id:next.id},data:{processedAt:new Date(),payload:{}}});
  await db.companyLeaderMembership.update({where:{id:f.membership.id},data:{revokedAt:new Date()}});
  await expect(recoverDelivery(db,f.adminActor,m.id,'SYNTHETIC-REVOKED')).rejects.toThrow('RECOVERY_NOT_ALLOWED');
});
it('F17 old auth credentials expire without send and are never operator-replayed',async()=>{
  const f=await fixture(db),eventId=randomUUID(),key='3'.repeat(64);await enqueueAuthEmail(db,{eventId,recipient:'synthetic-otp@example.invalid',subject:'Synthetic auth',text:'SYNTHETIC-CREDENTIAL',html:'<p>SYNTHETIC-CREDENTIAL</p>'},key);
  const row=await db.outboxMessage.findFirstOrThrow({where:{type:'AUTH_EMAIL',processedAt:null,createdAt:{gt:new Date(Date.now()-5000)}},orderBy:{createdAt:'desc'}});await db.outboxMessage.update({where:{id:row.id},data:{createdAt:new Date(0),availableAt:new Date(0)}});await reconcileExpiredDeliveryLeases(db);
  let sends=0;await deliverNextAuthEmail(db,{send:async()=>{sends++;return {provider:'smtp',messageId:'synthetic'};},close(){}},key);expect(sends).toBe(0);
  expect((await db.outboxMessage.findUniqueOrThrow({where:{id:row.id}})).payload).toEqual({});await expect(recoverDelivery(db,f.adminActor,row.id,'SYNTHETIC-AUTH-REPLAY')).rejects.toThrow('RECOVERY_NOT_ALLOWED');
});
it('F17 accepted send with lost lease acknowledgement does not overwrite the new owner or falsely mark delivery sent',async()=>{
  const {m}=await message();const another=randomUUID();
  const result=await deliverNextBusinessEmail(db,{send:async()=>{await db.outboxMessage.update({where:{id:m.id},data:{leaseOwner:another,attempts:8}});return {provider:'smtp',messageId:'synthetic-accepted'};},close(){}},'https://synthetic.example.invalid',async()=> 'synthetic@example.invalid');
  expect(result).toBe('UNCERTAIN');expect((await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:m.id}})).status).not.toBe('SENT');expect((await db.outboxMessage.findUniqueOrThrow({where:{id:m.id}})).leaseOwner).toBe(another);
  await db.outboxMessage.update({where:{id:m.id},data:{leaseExpiresAt:new Date(0)}});await reconcileExpiredDeliveryLeases(db);expect((await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:m.id}})).status).toBe('UNKNOWN');
});
it('F17 exhausted send failures retain only a minimal recovery recipe and failure visibility',async()=>{
  const {f,m}=await message(7),owner=randomUUID();const claimed=await transaction(db,tx=>claimDelivery(tx,['BUSINESS_EMAIL'],8,owner,new Date()));expect(claimed?.id).toBe(m.id);await finishDeliveryFailure(db,m.id,owner,8,8);
  const terminal=await db.outboxMessage.findUniqueOrThrow({where:{id:m.id}});expect(terminal.payload).toEqual({});expect(terminal.recoveryPayload).toEqual({registrationId:f.registration.id,recipientUserId:f.leader.id});
  const signals=await adminOperationalSignals(db,f.adminActor);expect(signals.failed).toBeGreaterThan(0);expect(signals.alerts).toContain('DELIVERY_FAILED');
});
