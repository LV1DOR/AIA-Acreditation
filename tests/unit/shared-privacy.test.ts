import {beforeEach,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import type {PrismaClient} from "../../packages/database/src/index.ts";
import {currentPrivacyNotice,publishPrivacyNotice,recordPrivacyAcknowledgement,assertCollectionAllowed} from "../../packages/domain/src/privacy/notices.ts";
import {approveEventRetentionPolicy} from "../../packages/domain/src/privacy/retention.ts";
import {privacyRetentionDates,privacyActionReference} from "../../packages/domain/src/privacy/settings.ts";

vi.mock("../../packages/config/src/index.ts",()=>({syntheticMode:()=>false,deploymentMode:()=>"production"}));
vi.mock("../../packages/domain/src/shared/transaction.ts",()=>({transaction:async(db:unknown,work:(tx:unknown)=>unknown)=>work(db)}));
vi.mock("../../packages/domain/src/auth/authorization.ts",()=>({
 resolveActor:vi.fn(async()=>({userId:"00000000-0000-4000-8000-000000000001",role:"ADMIN",correlationId:"00000000-0000-4000-8000-000000000002"})),
 requireAdmin:(actor:{role:string})=>{if(actor.role!=="ADMIN")throw new Error("FORBIDDEN");},
}));
vi.mock("../../packages/domain/src/submissions/integrity.ts",()=>({invalidateEffectiveApproval:vi.fn()}));
vi.mock("../../packages/domain/src/submissions/snapshot-crypto.ts",()=>({decryptSubmissionSnapshot:vi.fn()}));
const eventId=randomUUID(),registrationId=randomUUID();
const context={clerkUserId:"fixture",correlationId:randomUUID()};
const row={id:randomUUID(),version:"v1",textPt:"Aviso partilhado para {event}.",textEn:"Shared privacy notice for {event}."};
function client(){
 return {event:{findUniqueOrThrow:vi.fn(async()=>({name:"Synthetic event"}))},
  privacyNotice:{findFirst:vi.fn(async()=>row),create:vi.fn(async({data}:{data:object})=>data)},
  eventRetentionPolicy:{findFirst:vi.fn(async()=>({id:randomUUID()})),create:vi.fn(async({data}:{data:object})=>data)},
  privacyAcknowledgement:{create:vi.fn(async({data}:{data:object})=>data)},
  auditEvent:{create:vi.fn(async()=>({}))},$queryRaw:vi.fn(async()=>[{unsafe:false}])};
}
beforeEach(()=>vi.clearAllMocks());
it("workers and company leaders receive the same published notice ID, text and hash",async()=>{
 const mock=client(),db=mock as unknown as PrismaClient;
 const worker=await currentPrivacyNotice(db,eventId,"WORKER","en"),leader=await currentPrivacyNotice(db,eventId,"LEADER","en");
 expect(leader).toEqual(worker);
 for(const [query] of mock.privacyNotice.findFirst.mock.calls as unknown as [{where:{kind:string}}][])
  expect(query.where.kind).toBe("WORKER");
});
it("requires the shared notice but never asks for a separate leader declaration",async()=>{
 const mock=client();await assertCollectionAllowed(mock as unknown as PrismaClient,eventId);
 expect(mock.privacyNotice.findFirst).toHaveBeenCalledTimes(1);
 mock.privacyNotice.findFirst.mockResolvedValueOnce(null as never);
 await expect(assertCollectionAllowed(mock as unknown as PrismaClient,eventId)).rejects.toThrow("PRIVACY_CONFIGURATION_REQUIRED");
});
it("records leader acceptance against the same worker notice, and rejects a forged presented hash",async()=>{
 const mock=client(),db=mock as unknown as PrismaClient;
 const notice=await currentPrivacyNotice(db,eventId,"WORKER","en");
 await recordPrivacyAcknowledgement(db,{eventId,registrationId,actorType:"COMPANY_LEADER",kind:"LEADER",version:notice.version,locale:"en",presentedHash:notice.hash});
 expect(mock.privacyAcknowledgement.create).toHaveBeenCalledWith({data:expect.objectContaining({noticeId:notice.id,noticeHash:notice.hash,presentedText:notice.text})});
 await expect(recordPrivacyAcknowledgement(db,{eventId,registrationId,actorType:"COMPANY_LEADER",kind:"LEADER",version:notice.version,presentedHash:"0".repeat(64)})).rejects.toThrow("PRIVACY_NOTICE_CHANGED");
});
it("publishes without a manual AIA reference, while retaining the authenticated actor's audit identifier",async()=>{
 const mock=client();await publishPrivacyNotice(mock as unknown as PrismaClient,context,{eventId,version:"v2",textPt:row.textPt,textEn:row.textEn,approved:true});
 expect(mock.privacyNotice.create).toHaveBeenCalledWith({data:expect.objectContaining({kind:"WORKER",approvalReference:"admin-action:00000000-0000-4000-8000-000000000002",approvedByUserId:"00000000-0000-4000-8000-000000000001"})});
 expect(mock.auditEvent.create).toHaveBeenCalledTimes(1);
});
it("accepts two policy dates and derives evidence/communications dates without a manual reference",async()=>{
 const mock=client(),recordsEraseAfter=new Date("2030-01-01"),backupsEraseAfter=new Date("2031-01-01");
 await approveEventRetentionPolicy(mock as unknown as PrismaClient,context,{eventId,recordsEraseAfter,backupsEraseAfter,approved:true,automaticPurge:false});
 expect(mock.eventRetentionPolicy.create).toHaveBeenCalledWith({data:expect.objectContaining({...privacyRetentionDates(recordsEraseAfter,backupsEraseAfter),approvalReference:privacyActionReference("00000000-0000-4000-8000-000000000002")})});
});
it("keeps admin authorisation and explicit notice approval",async()=>{
 const {resolveActor}=await import("../../packages/domain/src/auth/authorization.ts");
 vi.mocked(resolveActor).mockResolvedValueOnce({userId:randomUUID(),role:"COMPANY_LEADER",correlationId:randomUUID()});
 await expect(publishPrivacyNotice(client() as unknown as PrismaClient,context,{eventId,version:"v1",textPt:row.textPt,textEn:row.textEn,approved:true})).rejects.toThrow("FORBIDDEN");
 await expect(publishPrivacyNotice(client() as unknown as PrismaClient,context,{eventId,version:"v1",textPt:row.textPt,textEn:row.textEn,approved:false as true})).rejects.toThrow();
});
