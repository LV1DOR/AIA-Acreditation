import { describe,expect,it } from "vitest";
import { presentNotification,type NotificationSource } from "../../apps/web/src/lib/notification-presentation.ts";

const base:NotificationSource={id:"notice-1",type:"REGISTRATION_UPDATED",eventId:"event-1",registrationId:"registration-1",parameters:{},eventName:"ELMS",companyName:"StageTeam",createdAt:new Date("2026-09-29T10:30:00Z"),readAt:null};

describe("notification presentation",()=>{
  it("turns a returned submission into a specific, non-technical leader notification",()=>{
    const result=presentNotification({...base,parameters:{updateKind:"RETURNED_FOR_CORRECTION",reasonCategory:"PHOTO"}},"en","COMPANY_LEADER");
    expect(result.title).toBe("Corrections requested");
    expect(result.description).toContain("StageTeam's submission for ELMS");
    expect(result.description).toContain("photo");
    expect(result.href).toBe("/en/company/registration-1/submission");
  });

  it("links a submitted request to the admin queue and names its purpose",()=>{
    const result=presentNotification({...base,type:"REQUEST_SUBMITTED",parameters:{requestType:"ZONE_CHANGE"}},"pt","ADMIN");
    expect(result.title).toBe("Novo pedido: alterar zonas");
    expect(result.description).toContain("StageTeam");
    expect(result.href).toBe("/pt/admin/queue");
  });

  it("links a new submission directly to the review record",()=>{
    const result=presentNotification({...base,type:"SUBMISSION_RECEIVED",parameters:{submissionId:"submission-1",submissionVersion:3}},"en","ADMIN");
    expect(result.description).toContain("version 3");
    expect(result.href).toBe("/en/admin/queue/submission-1");
  });
});
