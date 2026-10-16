import { assertRegistrationNotErasing } from "../privacy/notices.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { countries } from "country-data-list";
import type { Prisma, PrismaClient } from "@aia/database";
import type { ActorContext } from "../shared/actor.ts";
import { requireAdmin, resolveActor } from "../auth/authorization.ts";
import { transaction, type Tx } from "../shared/transaction.ts";
import { appendAudit } from "../audit/append.ts";
import { DomainError } from "../shared/errors.ts";
import { calendarDate, toDate } from "../shared/calendar-date.ts";
import { normalizePhoneNumber } from "../participants/phone.ts";
import { protectDocumentNumber, revealDocumentNumber } from "../participants/identity.ts";
import { invalidateEffectiveApproval } from "../submissions/integrity.ts";
import { enqueueInvalidation } from "../notifications/outbox.ts";
import { internalTemplate, readInternalSpreadsheet, type ImportRow } from "./spreadsheet.ts";

const nationalityCodes=new Set(countries.all.map(c=>c.alpha2));
type Client=PrismaClient|Tx;
type Keys={encryptionKey:string;fingerprintKey:string};
const target=z.object({eventId:z.uuid(),organisation:z.enum(["AIA","PARKALGAR"]),personnelLimit:z.number().int().min(1).max(10000).default(1000)}).strict();
export async function ensureInternalRegistration(db:PrismaClient,context:ActorContext,raw:z.input<typeof target>) {
  const input=target.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);
    const event=await tx.event.findUniqueOrThrow({where:{id:input.eventId}});
    if(event.status==="ARCHIVED") throw new DomainError("EDIT_LOCKED");
    const company=await tx.company.upsert({where:{internalOrganisation:input.organisation},create:{name:input.organisation==="AIA"?"AIA":"Parkalgar",internalOrganisation:input.organisation},update:{}});
    if(company.deactivatedAt) throw new DomainError("EDIT_LOCKED");
    const existing=await tx.companyEventRegistration.findUnique({where:{eventId_companyId:{eventId:event.id,companyId:company.id}}});
    if(existing) return existing;
    const registration=await tx.companyEventRegistration.create({data:{eventId:event.id,companyId:company.id,personnelLimit:input.personnelLimit}});
    await appendAudit(tx,actor,{action:"REGISTRATION_CREATED",entityType:"CompanyEventRegistration",entityId:registration.id,eventId:event.id,companyId:company.id});
    return registration;
  });
}

async function internalTarget(db:Client,context:ActorContext,registrationId:string) {
  const actor=await resolveActor(db,context);requireAdmin(actor);
  const r=await db.companyEventRegistration.findUnique({where:{id:z.uuid().parse(registrationId)},include:{company:true,event:true}});
  if(!r || !r.company.internalOrganisation || r.company.deactivatedAt || r.event.status==="ARCHIVED") throw new DomainError("FORBIDDEN");
  await assertRegistrationNotErasing(db,r.id);
  return {actor,r};
}
export async function internalImportContext(db:PrismaClient,context:ActorContext,registrationId:string) {
  const {r}=await internalTarget(db,context,registrationId);
  const zones=await db.eventZone.findMany({where:{eventId:r.eventId,deactivatedAt:null,zone:{deactivatedAt:null}},include:{zone:true},orderBy:{zone:{sortOrder:"asc"}}});
  const roles=await db.jobRole.findMany({where:{deactivatedAt:null},orderBy:{sortOrder:"asc"}});
  return {registration:r,event:r.event,organisation:r.company.internalOrganisation!,zones:zones.map(x=>({id:x.zoneId,name:x.zone.name})),roles:roles.map(x=>({id:x.id,name:x.name}))};
}
export async function downloadInternalTemplate(db:PrismaClient,context:ActorContext,registrationId:string) {
  return internalTemplate(await internalImportContext(db,context,registrationId));
}

type CheckedRow={row:number;name:string;state:"INCOMPLETE"|"INVALID"|"EXISTING"|"DUPLICATE";errors:string[];missing:string[];zoneIds:string[];roleId:string|null;data:ImportRow;fingerprint:string|null};
async function checkRows(db:Client,registration:Awaited<ReturnType<typeof internalTarget>>["r"],rows:ImportRow[],keys:Keys) {
  const [zones,roles,existing]=await Promise.all([
    db.eventZone.findMany({where:{eventId:registration.eventId,deactivatedAt:null,zone:{deactivatedAt:null}},select:{zoneId:true}}),
    db.jobRole.findMany({where:{deactivatedAt:null},select:{id:true}}),
    db.eventParticipant.findMany({where:{eventId:registration.eventId},select:{id:true,registrationId:true,internalReference:true,documentNumberFingerprint:true,status:true}}),
  ]);
  const zoneIds=new Set(zones.map(x=>x.zoneId)),roleIds=new Set(roles.map(x=>x.id));
  const references=new Set<string>(),fingerprints=new Set<string>(),rowHashes=new Set<string>();
  return rows.map((data,i):CheckedRow=>{
    const errors:string[]=[],missing:string[]=["Fotografia / Photograph","Aviso de privacidade / Privacy notice"];
    const rowHash=createHash("sha256").update(JSON.stringify(data)).digest("hex");
    if(rowHashes.has(rowHash)) errors.push("Linha repetida / Duplicate row");
    rowHashes.add(rowHash);
    const name=data["Nome Completo"],requestedZones=data["Zonas de Acesso"]?data["Zonas de Acesso"].split(";").map(x=>x.trim()):[];
    const row:CheckedRow={row:i+2,name,state:"INCOMPLETE",errors,missing,zoneIds:requestedZones,roleId:data["Função"]||null,data,fingerprint:null};
    if(!name || name.length<2 || name.length>200) errors.push("Nome Completo / Full name: 2–200 caracteres / characters");
    if(data["Organização"].toUpperCase()!==registration.company.internalOrganisation) errors.push("Organização diferente da seleção / Organisation does not match selection");
    for(const key of ["Data de Nascimento","Validade do Documento"] as const) {
      const value=data[key];
      if(!value) missing.push(key);
      else if(!calendarDate.safeParse(value).success) errors.push(`${key}: AAAA-MM-DD / YYYY-MM-DD`);
      else if(key==="Data de Nascimento" && toDate(value)>new Date()) errors.push("Nascimento no futuro / Birth date is in the future");
      else if(key==="Validade do Documento" && toDate(value)<registration.event.endDate) errors.push("Documento expira antes do fim do evento / Document expires before event end");
    }
    const type=z.enum(["PASSPORT","CARTAO_CIDADAO","CARTAO_RESIDENCIA"]).safeParse(data["Tipo de Documento"]);
    if(!data["Tipo de Documento"]) missing.push("Tipo de Documento"); else if(!type.success) errors.push("Tipo de Documento inválido / Invalid document type");
    if(data["Número de Documento"] && (!type.success || data["Número de Documento"].length>100)) errors.push("Número de Documento: tipo válido obrigatório, máximo 100 caracteres / Document number: valid type required, maximum 100 characters");
    if(!data["Número de Documento"]) missing.push("Número de Documento");
    else if(type.success) {try{row.fingerprint=protectDocumentNumber(type.data,data["Número de Documento"],randomUUID(),keys.encryptionKey,keys.fingerprintKey).documentNumberFingerprint;}catch{errors.push("Número de Documento inválido / Invalid document number");}}
    if(!data["Telemóvel"]) missing.push("Telemóvel"); else {try{if(data["Telemóvel"].length>40)throw new Error();normalizePhoneNumber(data["Telemóvel"]);}catch{errors.push("Telemóvel inválido / Invalid phone");}}
    if(!data["Nacionalidade"]) missing.push("Nacionalidade"); else if(!nationalityCodes.has(data["Nacionalidade"].toUpperCase())) errors.push("Nacionalidade: código ISO de 2 letras / Nationality: 2-letter ISO code");
    if(!row.roleId) missing.push("Função"); else if(!roleIds.has(row.roleId)) errors.push("Função: UUID ativo obrigatório / Job role: active UUID required");
    const days=data["Dias de Trabalho"]?data["Dias de Trabalho"].split(";").map(x=>x.trim()):[];
    if(!days.length) missing.push("Dias de Trabalho");
    if(days.length>366 || new Set(days).size!==days.length || days.some(x=>!calendarDate.safeParse(x).success || toDate(x)<registration.event.startDate || toDate(x)>registration.event.endDate)) errors.push("Dias de Trabalho inválidos / Invalid or duplicate work days");
    if(!requestedZones.length) missing.push("Zonas de Acesso");
    if(new Set(requestedZones).size!==requestedZones.length || requestedZones.some(x=>!zoneIds.has(x))) errors.push("Zonas desconhecidas, repetidas ou inativas / Unknown, duplicate or inactive zones");
    const ref=data["Referência Interna"];
    if(ref && (!/^[\p{L}\p{N}_.-]{1,100}$/u.test(ref) || references.has(ref))) errors.push("Referência Interna inválida ou repetida / Invalid or duplicate internal reference");
    if(data["Fotografia"] && !/^[\p{L}\p{N} _.-]{1,200}\.(jpg|jpeg|png)$/iu.test(data["Fotografia"])) errors.push("Fotografia: apenas nome de ficheiro JPG/PNG / Photograph: JPG/PNG filename only");
    const same=existing.find(x=>x.registrationId===registration.id && ((ref && x.internalReference===ref) || (row.fingerprint && x.documentNumberFingerprint===row.fingerprint)));
    const duplicate=Boolean(row.fingerprint && (fingerprints.has(row.fingerprint) || existing.some(x=>x.registrationId!==registration.id && x.documentNumberFingerprint===row.fingerprint && !["REMOVED","REPLACED"].includes(x.status))));
    row.state=errors.length?"INVALID":same?"EXISTING":duplicate?"DUPLICATE":"INCOMPLETE";
    if(ref) references.add(ref); if(row.fingerprint) fingerprints.add(row.fingerprint);
    return row;
  });
}
function publicPreview(rows:CheckedRow[],version:number,fileHash:string) {
  return {fileHash,expectedVersion:version,total:rows.length,valid:0,incomplete:rows.filter(x=>x.state==="INCOMPLETE").length,invalid:rows.filter(x=>x.state==="INVALID").length,duplicates:rows.filter(x=>x.state==="DUPLICATE").length,create:rows.filter(x=>["INCOMPLETE","DUPLICATE"].includes(x.state)).length,skip:rows.filter(x=>["EXISTING","INVALID"].includes(x.state)).length,update:0,zoneAssignments:rows.filter(x=>!["INVALID","EXISTING"].includes(x.state)).reduce((n,x)=>n+x.zoneIds.length,0),rows:rows.map(({row,name,state,errors,missing,zoneIds,roleId,data})=>({row,name,state,errors,missing,zoneIds,roleId,dateOfBirth:data["Data de Nascimento"],documentType:data["Tipo de Documento"],documentExpiry:data["Validade do Documento"],mobile:data["Telemóvel"],nationality:data["Nacionalidade"],organisation:data["Organização"],reference:data["Referência Interna"],workDays:data["Dias de Trabalho"],documentLast3:data["Número de Documento"].slice(-3),photoReference:data["Fotografia"]}))};
}
export async function previewInternalImport(db:PrismaClient,context:ActorContext,registrationId:string,bytes:Uint8Array,filename:string,keys:Keys) {
  const {r}=await internalTarget(db,context,registrationId);
  if(!["DRAFT","RETURNED_FOR_CORRECTION"].includes(r.status)) throw new DomainError("EDIT_LOCKED");
  const rows=await readInternalSpreadsheet(bytes,filename);
  return publicPreview(await checkRows(db,r,rows,keys),r.version,createHash("sha256").update(bytes).digest("hex"));
}
const commitSchema=z.object({registrationId:z.uuid(),expectedVersion:z.number().int().positive(),fileHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
export async function commitInternalImport(db:PrismaClient,context:ActorContext,raw:z.input<typeof commitSchema>,bytes:Uint8Array,filename:string,keys:Keys) {
  const input=commitSchema.parse(raw);
  await internalTarget(db,context,input.registrationId); // authorise before parsing
  const fileHash=createHash("sha256").update(bytes).digest("hex");
  if(fileHash!==input.fileHash) throw new DomainError("STALE_WRITE");
  const data=await readInternalSpreadsheet(bytes,filename);
  return transaction(db,async tx=>{
    const {actor,r}=await internalTarget(tx,context,input.registrationId);
    const prior=await tx.internalImportBatch.findUnique({where:{registrationId_fileHash:{registrationId:r.id,fileHash}}});
    if(prior) return {...prior,replayed:true};
    if(!["DRAFT","RETURNED_FOR_CORRECTION"].includes(r.status) || r.version!==input.expectedVersion) throw new DomainError("STALE_WRITE");
    const rows=await checkRows(tx,r,data,keys);
    const create=rows.filter(x=>["INCOMPLETE","DUPLICATE"].includes(x.state));
    const count=await tx.eventParticipant.count({where:{registrationId:r.id,status:{notIn:["REMOVED","REPLACED"]}}});
    if(count+create.length>r.personnelLimit) throw new DomainError("PERSONNEL_LIMIT_REACHED");
    // No writes to existing personnel. Changed files must use the explicit edit workflow.
    const participants:Prisma.EventParticipantCreateManyInput[]=[],days:Prisma.ParticipantWorkDayCreateManyInput[]=[],zones:Prisma.ParticipantZoneRequestCreateManyInput[]=[];
    for(const row of create) {
      const d=row.data,id=randomUUID(),type=d["Tipo de Documento"] as "PASSPORT"|"CARTAO_CIDADAO"|"CARTAO_RESIDENCIA";
      participants.push({id,registrationId:r.id,eventId:r.eventId,fullName:row.name,status:row.state==="DUPLICATE"?"DUPLICATE_REVIEW_REQUIRED":"DRAFT",dateOfBirth:d["Data de Nascimento"]?toDate(d["Data de Nascimento"]):null,documentType:type||null,...(d["Número de Documento"] && type?protectDocumentNumber(type,d["Número de Documento"],id,keys.encryptionKey,keys.fingerprintKey):{}),documentExpiryDate:d["Validade do Documento"]?toDate(d["Validade do Documento"]):null,mobileE164:d["Telemóvel"]?normalizePhoneNumber(d["Telemóvel"]):null,nationalityCode:d["Nacionalidade"].toUpperCase()||null,jobRoleId:row.roleId,internalReference:d["Referência Interna"]||null,photoReference:d["Fotografia"]||null});
      if(d["Dias de Trabalho"]) days.push(...d["Dias de Trabalho"].split(";").map(day=>({participantId:id,workDate:toDate(day.trim())})));
      zones.push(...row.zoneIds.map(zoneId=>({participantId:id,eventId:r.eventId,zoneId})));
    }
    await tx.eventParticipant.createMany({data:participants});
    await tx.participantWorkDay.createMany({data:days});
    await tx.participantZoneRequest.createMany({data:zones});
    const batch=await tx.internalImportBatch.create({data:{registrationId:r.id,fileHash,createdByUserId:actor.userId,createdCount:create.length,skippedCount:rows.length-create.length}});
    await tx.companyEventRegistration.update({where:{id:r.id},data:{version:{increment:1}}});
    await appendAudit(tx,actor,{action:"INTERNAL_IMPORTED",entityType:"InternalImportBatch",entityId:batch.id,eventId:r.eventId,companyId:r.companyId,metadata:{version:r.version+1}});
    await enqueueInvalidation(tx,`internal-import:${batch.id}`,{entityId:r.id,eventId:r.eventId,version:r.version+1});
    return {...batch,replayed:false};
  });
}

export async function internalWorkers(db:PrismaClient,context:ActorContext,registrationId:string,keys:Keys) {
  const {r}=await internalTarget(db,context,registrationId);
  const workers=await db.eventParticipant.findMany({where:{registrationId:r.id},include:{workDays:true,individualZones:{include:{eventZone:{include:{zone:true}}}}},orderBy:{fullName:"asc"}});
  return {registration:r,workers:workers.map(p=>({...p,documentNumber:revealDocumentNumber(p,keys.encryptionKey)}))};
}
export async function internalWorkerHistory(db:PrismaClient,context:ActorContext,participantId:string) {
  const actor=await resolveActor(db,context);requireAdmin(actor);
  const p=await db.eventParticipant.findUniqueOrThrow({where:{id:z.uuid().parse(participantId)}});
  await internalTarget(db,context,p.registrationId);
  const rows=await db.auditEvent.findMany({where:{entityType:"EventParticipant",entityId:p.id,eventId:p.eventId},orderBy:{occurredAt:"desc"},take:50,select:{id:true,action:true,occurredAt:true,actorType:true,metadata:true}});
  const metadata=z.object({reason:z.string().optional(),zoneIds:z.array(z.uuid()).optional(),previousZoneIds:z.array(z.uuid()).optional(),version:z.number().optional()});
  const catalog=await db.zone.findMany({where:{events:{some:{eventId:p.eventId}}},select:{id:true,name:true}});
  return rows.map(row=>{const data=metadata.parse(row.metadata);return {...row,metadata:undefined,reason:data.reason,version:data.version,zones:data.zoneIds?.map(id=>catalog.find(z=>z.id===id)?.name??id),previousZones:data.previousZoneIds?.map(id=>catalog.find(z=>z.id===id)?.name??id)};});
}
export async function reopenInternalRegistration(db:PrismaClient,context:ActorContext,registrationId:string,expectedVersion:number,reason:string) {
  z.string().trim().min(5).max(1000).parse(reason);
  return transaction(db,async tx=>{
    const {actor,r}=await internalTarget(tx,context,registrationId);
    if(r.version!==expectedVersion || !["APPROVED","AIA_REVIEW"].includes(r.status)) throw new DomainError("STALE_WRITE");
    await invalidateEffectiveApproval(tx,actor,r.id);
    await appendAudit(tx,actor,{action:"SUBMISSION_REOPENED",entityType:"CompanyEventRegistration",entityId:r.id,eventId:r.eventId,companyId:r.companyId,metadata:{reason}});
  });
}
const zoneInput=z.object({participantId:z.uuid(),expectedVersion:z.number().int().positive(),zoneIds:z.array(z.uuid()).max(1000).refine(x=>new Set(x).size===x.length),reason:z.string().trim().min(5).max(1000)}).strict();
export async function updateInternalWorkerZones(db:PrismaClient,context:ActorContext,raw:z.input<typeof zoneInput>) {
  const input=zoneInput.parse(raw);
  return transaction(db,async tx=>{
    const actor=await resolveActor(tx,context);requireAdmin(actor);
    const p=await tx.eventParticipant.findUniqueOrThrow({where:{id:input.participantId}});
    const {r}=await internalTarget(tx,context,p.registrationId);
    if(p.version!==input.expectedVersion || ["REMOVED","REPLACED"].includes(p.status) || ["DRAFT","ARCHIVED"].includes(r.event.status) || r.status==="REJECTED") throw new DomainError("EDIT_LOCKED");
    const matches=await tx.eventZone.count({where:{eventId:r.eventId,zoneId:{in:input.zoneIds},deactivatedAt:null,zone:{deactivatedAt:null}}});
    if(matches!==input.zoneIds.length) throw new DomainError("INVALID_INPUT");
    await invalidateEffectiveApproval(tx,actor,r.id);
    const previousZones=await tx.participantZoneRequest.findMany({where:{participantId:p.id},select:{zoneId:true}});
    await tx.participantZoneRequest.deleteMany({where:{participantId:p.id}});
    await tx.participantZoneRequest.createMany({data:input.zoneIds.map(zoneId=>({participantId:p.id,eventId:r.eventId,zoneId}))});
    await tx.eventParticipant.update({where:{id:p.id},data:{version:{increment:1},...(p.status==="LEADER_APPROVED"?{status:"AWAITING_LEADER_REVIEW"}:{})}});
    await tx.companyEventRegistration.update({where:{id:r.id},data:{version:{increment:1}}});
    await appendAudit(tx,actor,{action:"INTERNAL_ZONES_UPDATED",entityType:"EventParticipant",entityId:p.id,eventId:r.eventId,companyId:r.companyId,metadata:{version:p.version+1,reason:input.reason,zoneIds:input.zoneIds,previousZoneIds:previousZones.map(x=>x.zoneId)}});
    await enqueueInvalidation(tx,`internal-zones:${p.id}:${p.version+1}`,{entityId:p.id,eventId:r.eventId,version:p.version+1});
  });
}
