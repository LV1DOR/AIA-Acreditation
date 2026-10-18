import {createElement} from "react";
import {syntheticMode} from "@aia/config";
import {getLocale} from "next-intl/server";
import type {Locale} from "@aia/i18n";
import {adminEventOptions,adminOperationalSignals,privacyOperationsOverview,deliveryRecoveryOverview} from "@aia/domain";
import {requirePortal} from "@/server/session.ts";
import {database} from "@/server/runtime.ts";
import {operationalAction} from "./actions.ts";
import {PrivacyOperationsView} from "./privacy-view.ts";

type Query={eventId?:string;result?:string;deliveryCursor?:string};
export default async function OperationsPage({searchParams}:{searchParams:Promise<Query>}) {
  const locale=await getLocale() as Locale;
  const access=await requirePortal(locale,"ADMIN"),db=database(),q=await searchParams;
  const [events,signals,deliveries]=await Promise.all([
    adminEventOptions(db,access.context),adminOperationalSignals(db,access.context),
    deliveryRecoveryOverview(db,access.context,q.deliveryCursor),
  ]);
  const event=events.find(e=>e.id===q.eventId)??events[0];
  const data=event?await privacyOperationsOverview(db,access.context,event.id):null;
  const date=(value:Date)=>value.toLocaleString(locale==="pt"?"pt-PT":"en-GB",{timeZone:"Europe/Lisbon",dateStyle:"medium",timeStyle:"short"});
  return createElement(PrivacyOperationsView,{
    locale,synthetic:syntheticMode(),event,events,signals,result:q.result,action:operationalAction,
    cleanupConfigured:Boolean(data?.policy&&data.policy.synthetic===syntheticMode()),
    notices:(["WORKER","LEADER"] as const).map(kind=>({kind,label:data?.notices.find(n=>n.kind===kind)?.version})),
    jobs:(data?.jobs??[]).slice(0,8).map(j=>({
      id:j.id,date:date(j.createdAt),dateTime:j.createdAt.toISOString(),
      company:data?.registrations.find(r=>r.id===j.registrationId)?.company.name,
      status:j.lastFailureCode?"ATTENTION":j.status,
    })),
    deliveries:deliveries.slice(0,20).map(d=>({
      id:d.id,date:date(d.createdAt),dateTime:d.createdAt.toISOString(),company:d.context?.company.name,event:d.context?.event.name,
      kind:d.type==="AUTH_EMAIL"?"auth":d.type==="LEADER_INVITATION_EMAIL"?"invitation":"update",
      uncertain:d.emailDelivery?.status==="UNKNOWN",recoverable:Boolean(d.terminalAt)&&["BUSINESS_EMAIL","DOMAIN_INVALIDATION"].includes(d.type),
    })),
    olderCursor:deliveries.length>20?deliveries[19]!.id:undefined,
  });
}
