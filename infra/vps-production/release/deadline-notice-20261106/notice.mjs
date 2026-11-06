import {createHash} from 'node:crypto';
export const EVENT='c995c218-d0f3-47b0-bf11-f6c7e841190d';
export const AUDIT='d122d026-2c3e-4293-8d9d-9254aa7fd9c5';
export const CORRELATION='a5cbada9-f8ef-4c2a-8ed3-dcf59311c672';
export const CAMPAIGN='deadline-inconvenience-20261106-v1';
export const subject='AIA — Esclarecimento sobre as acreditações / Accreditation clarification';
export const text=`Caros responsáveis,

Devido a um erro técnico durante a atualização do prazo de inscrição, algumas empresas receberam um email a indicar que a sua participação tinha sido «Devolvida para correção».

O problema foi resolvido. Se receberam esse email devido a este incidente, podem ignorá-lo. As aprovações anteriores foram repostas e não é necessário voltar a submeter os dados.

Pedimos desculpa pelo incómodo e agradecemos a compreensão.

Equipa AIA

────────────────────

Dear company representatives,

Due to a technical error while updating the registration deadline, some companies received an email stating that their registration had been “Returned for correction.”

The issue has been resolved. If you received that email because of this incident, please disregard it. Previous approvals have been restored, and there is no need to resubmit your details.

We apologise for the inconvenience and appreciate your understanding.

The AIA Team`;
export const html=text.split('\n\n').map(p=>{
 if(p.startsWith('──'))return '<hr/>';
 const escaped=p.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 return '<p>'+((p.startsWith('O problema foi resolvido.')||p.startsWith('The issue has been resolved.'))?'<strong>'+escaped+'</strong>':escaped)+'</p>';
}).join('');
export const digest=s=>createHash('sha256').update(s).digest('hex');
export function id(kind,key){const h=digest(CAMPAIGN+':'+kind+':'+key);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
export function included(r,change,edit){
 if(r.eventId!==EVENT||r.erasedAt||r.withdrawnAt||r.company.deactivatedAt||r.company.internalOrganisation)return false;
 if(r.status==='APPROVED')return true;
 if(!change||change.entityId!==r.id||change.eventId!==EVENT||change.correlationId!==CORRELATION||change.action!=='APPROVAL_INVALIDATED')return false;
 const reviews=r.submissions.flatMap(s=>s.reviews).filter(v=>new Date(v.createdAt)<=new Date(edit.occurredAt)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 const [last,prior]=reviews;
 return last?.outcome==='APPROVAL_INVALIDATED'&&prior?.outcome==='APPROVED'&&last.submissionId===prior.submissionId&&last.reviewedByUserId===edit.actorUserId&&Math.abs(new Date(last.createdAt)-new Date(change.occurredAt))<=2000;
}
export function uniqueRecipients(rows){
 const map=new Map();for(const r of rows){const key=r.email.trim().toLowerCase();if(!map.has(key))map.set(key,{...r,email:r.email.trim(),registrationIds:[]});map.get(key).registrationIds.push(r.registrationId);}return [...map.values()];
}
export function ledgerState(claim,receipt){
 if(claim&&!receipt)throw Error('PREVIOUS_SEND_UNCERTAIN_CHECK_PROVIDER_BEFORE_RETRY');
 if(receipt&&!claim)throw Error('NOTICE_LEDGER_INCONSISTENT');
 return receipt?'ACCEPTED':'NEW';
}
