import type { Locale } from "@aia/i18n";
import type { IconName } from "../components/portal-icon.tsx";

export type NotificationSource = { id:string; type:string; eventId:string|null; registrationId:string|null; parameters:unknown; eventName:string|null; companyName:string|null; createdAt:Date; readAt:Date|null };
export type NotificationPresentation = { id:string; title:string; description:string; time:string; href:string; icon:IconName; unread:boolean };

const copy = {
  pt: {
    company:"a sua empresa", event:"o evento",
    configured:"Participação atualizada", configuredText:(company:string,event:string)=>`A AIA atualizou as definições de participação de ${company} em ${event}.`,
    approved:"Submissão final aprovada", approvedText:(company:string,event:string)=>`A submissão de ${company} para ${event} foi aprovada pela AIA.`,
    returned:"Correções solicitadas", returnedText:(company:string,event:string,reason:string)=>`A submissão de ${company} para ${event} foi devolvida para corrigir: ${reason}.`,
    rejected:"Submissão final rejeitada", rejectedText:(company:string,event:string)=>`A submissão de ${company} para ${event} foi rejeitada pela AIA.`,
    updated:"Participação atualizada", updatedText:(company:string,event:string)=>`Existe uma atualização na participação de ${company} em ${event}.`,
    vehicleApproved:"Passes de veículo aprovados", vehicleApprovedText:(company:string,event:string)=>`A AIA aprovou os passes de veículo de ${company} para ${event}.`,
    vehicleRejected:"Passes de veículo não aprovados", vehicleRejectedText:(company:string,event:string)=>`A AIA não aprovou os passes de veículo de ${company} para ${event}.`,
    received:"Nova submissão final", receivedText:(company:string,event:string,version?:number)=>`${company} enviou ${version ? `a versão ${version}`:"uma submissão"} para ${event}. Está pronta para revisão.`,
    requestReceived:(request:string)=>`Novo pedido: ${request}`, requestReceivedText:(company:string,event:string)=>`${company} enviou um pedido para ${event}.`,
    requestApproved:(request:string)=>`Pedido aprovado: ${request}`, requestApprovedText:(company:string,event:string)=>`A AIA aprovou o pedido de ${company} para ${event}.`,
    requestRejected:(request:string)=>`Pedido não aprovado: ${request}`, requestRejectedText:(company:string,event:string)=>`A AIA não aprovou o pedido de ${company} para ${event}.`,
    deadline:"Prazo de submissão a aproximar-se", deadlineText:(company:string,event:string)=>`A submissão final de ${company} para ${event} aproxima-se do prazo.`,
    requests:{EXTRA_PERSONNEL:"pessoal adicional",ADD_AFTER_DEADLINE:"adicionar pessoa após o prazo",REMOVE_AFTER_DEADLINE:"remover pessoa após o prazo",REPLACE_PERSON:"substituição urgente",EDIT_PERSON:"alterar dados de uma pessoa",CHANGE_WORK_DAYS:"alterar dias de trabalho",REPLACE_PHOTO:"substituir fotografia",VEHICLE_PASS_CHANGE:"alterar passe de veículo",ZONE_CHANGE:"alterar zonas",OTHER:"outro pedido"},
    reasons:{ZONES:"zonas",VEHICLE_PASS:"passe de veículo",PERSONNEL:"dados da equipa",PHOTO:"fotografia",DOCUMENT:"documento de identificação",WORK_DAYS:"dias de trabalho",HEADCOUNT:"limite de pessoas",DUPLICATE:"possível duplicado",OTHER:"outros dados"},
  },
  en: {
    company:"your company", event:"the event",
    configured:"Participation updated", configuredText:(company:string,event:string)=>`AIA updated ${company}'s participation settings for ${event}.`,
    approved:"Final submission approved", approvedText:(company:string,event:string)=>`AIA approved ${company}'s submission for ${event}.`,
    returned:"Corrections requested", returnedText:(company:string,event:string,reason:string)=>`${company}'s submission for ${event} was returned to correct: ${reason}.`,
    rejected:"Final submission rejected", rejectedText:(company:string,event:string)=>`AIA rejected ${company}'s submission for ${event}.`,
    updated:"Participation updated", updatedText:(company:string,event:string)=>`There is an update to ${company}'s participation in ${event}.`,
    vehicleApproved:"Vehicle passes approved", vehicleApprovedText:(company:string,event:string)=>`AIA approved ${company}'s vehicle passes for ${event}.`,
    vehicleRejected:"Vehicle passes not approved", vehicleRejectedText:(company:string,event:string)=>`AIA did not approve ${company}'s vehicle passes for ${event}.`,
    received:"New final submission", receivedText:(company:string,event:string,version?:number)=>`${company} sent ${version ? `version ${version}`:"a submission"} for ${event}. It is ready for review.`,
    requestReceived:(request:string)=>`New request: ${request}`, requestReceivedText:(company:string,event:string)=>`${company} sent a request for ${event}.`,
    requestApproved:(request:string)=>`Request approved: ${request}`, requestApprovedText:(company:string,event:string)=>`AIA approved ${company}'s request for ${event}.`,
    requestRejected:(request:string)=>`Request not approved: ${request}`, requestRejectedText:(company:string,event:string)=>`AIA did not approve ${company}'s request for ${event}.`,
    deadline:"Submission deadline approaching", deadlineText:(company:string,event:string)=>`${company}'s final submission for ${event} is approaching its deadline.`,
    requests:{EXTRA_PERSONNEL:"extra personnel",ADD_AFTER_DEADLINE:"add a person after the deadline",REMOVE_AFTER_DEADLINE:"remove a person after the deadline",REPLACE_PERSON:"emergency replacement",EDIT_PERSON:"change a person's details",CHANGE_WORK_DAYS:"change work days",REPLACE_PHOTO:"replace a photo",VEHICLE_PASS_CHANGE:"change a vehicle pass",ZONE_CHANGE:"change zones",OTHER:"other request"},
    reasons:{ZONES:"zones",VEHICLE_PASS:"vehicle pass",PERSONNEL:"team details",PHOTO:"photo",DOCUMENT:"identity document",WORK_DAYS:"work days",HEADCOUNT:"person limit",DUPLICATE:"possible duplicate",OTHER:"other details"},
  },
} as const;

function values(input:unknown):Record<string,string|number|boolean|null>{ return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string,string|number|boolean|null> : {}; }

export function presentNotification(source:NotificationSource,locale:Locale,role:"ADMIN"|"COMPANY_LEADER"):NotificationPresentation {
  const c=copy[locale], parameters=values(source.parameters), company=source.companyName??c.company, event=source.eventName??c.event;
  const request=c.requests[parameters.requestType as keyof typeof c.requests]??c.requests.OTHER;
  const reason=c.reasons[parameters.reasonCategory as keyof typeof c.reasons]??c.reasons.OTHER;
  const roleHome=role==="ADMIN"?`/${locale}/admin`:`/${locale}/company`, companyHome=source.registrationId?`/${locale}/company/${source.registrationId}`:roleHome;
  const requestHref=role==="ADMIN"?`/${locale}/admin/queue`:`${companyHome}/requests`;
  const time=new Intl.DateTimeFormat(locale==="pt"?"pt-PT":"en-GB",{dateStyle:"medium",timeStyle:"short"}).format(source.createdAt);
  const base={id:source.id,time,unread:!source.readAt};
  if(source.type==="SUBMISSION_RECEIVED") return {...base,title:c.received,description:c.receivedText(company,event,typeof parameters.submissionVersion==="number"?parameters.submissionVersion:undefined),href:typeof parameters.submissionId==="string"?`/${locale}/admin/queue/${parameters.submissionId}`:roleHome,icon:"document"};
  if(source.type==="REQUEST_SUBMITTED") return {...base,title:c.requestReceived(request),description:c.requestReceivedText(company,event),href:requestHref,icon:"alert"};
  if(source.type==="REQUEST_APPROVED") return {...base,title:c.requestApproved(request),description:c.requestApprovedText(company,event),href:requestHref,icon:"check"};
  if(source.type==="REQUEST_REJECTED") return {...base,title:c.requestRejected(request),description:c.requestRejectedText(company,event),href:requestHref,icon:"alert"};
  if(source.type==="DEADLINE_REMINDER") return {...base,title:c.deadline,description:c.deadlineText(company,event),href:`${companyHome}/submission`,icon:"clock"};
  if(source.type==="REGISTRATION_UPDATED") {
    if(parameters.updateKind==="VEHICLE_PASS_APPROVED") return {...base,title:c.vehicleApproved,description:c.vehicleApprovedText(company,event),href:companyHome,icon:"car"};
    if(parameters.updateKind==="VEHICLE_PASS_REJECTED") return {...base,title:c.vehicleRejected,description:c.vehicleRejectedText(company,event),href:companyHome,icon:"car"};
    if(parameters.updateKind==="APPROVED") return {...base,title:c.approved,description:c.approvedText(company,event),href:`${companyHome}/submission`,icon:"check"};
    if(parameters.updateKind==="RETURNED_FOR_CORRECTION") return {...base,title:c.returned,description:c.returnedText(company,event,reason),href:`${companyHome}/submission`,icon:"alert"};
    if(parameters.updateKind==="REJECTED") return {...base,title:c.rejected,description:c.rejectedText(company,event),href:`${companyHome}/submission`,icon:"alert"};
    if(parameters.updateKind==="REGISTRATION_CONFIGURATION") return {...base,title:c.configured,description:c.configuredText(company,event),href:companyHome,icon:"settings"};
    return {...base,title:c.updated,description:c.updatedText(company,event),href:companyHome,icon:"info"};
  }
  return {...base,title:c.updated,description:c.updatedText(company,event),href:roleHome,icon:"info"};
}
