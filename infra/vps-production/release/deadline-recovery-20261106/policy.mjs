// Pure fail-closed selection and snapshot derivation. No I/O or personal-data output.
export const EVENT='c995c218-d0f3-47b0-bf11-f6c7e841190d';
export const AUDIT='d122d026-2c3e-4293-8d9d-9254aa7fd9c5';
export const CORRELATION='a5cbada9-f8ef-4c2a-8ed3-dcf59311c672';
export const DEADLINE='2026-11-10T23:55:00.000Z';
const iso=v=>v==null?null:new Date(v).toISOString();
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const zones=a=>(a??[]).map(z=>({id:z.zoneId??z.id,name:z.eventZone?.zone.name??z.name})).sort((a,b)=>a.id.localeCompare(b.id));
export function assertEvent(event,edit){
 if(event.id!==EVENT||event.version!==5||iso(event.onboardingClosesAt)!==DEADLINE||['DRAFT','ARCHIVED'].includes(event.status)||edit.id!==AUDIT||edit.eventId!==EVENT||edit.correlationId!==CORRELATION||edit.metadata?.version!==5)throw Error('EXACT_DEADLINE_EDIT_CHANGED_ABORT');
}
export function eligibility(event,edit,change,r,snapshot,postAudits,erasureCount){
 const reject=reason=>({eligible:false,reason,registrationId:r.id});
 if(change.correlationId!==CORRELATION||change.eventId!==EVENT||change.entityId!==r.id||r.eventId!==EVENT)return reject('SCOPE_MISMATCH');
 if(r.status!=='RETURNED_FOR_CORRECTION'||r.version!==change.metadata?.version||r.withdrawnAt||r.erasedAt||r.company.deactivatedAt||erasureCount)return reject('REGISTRATION_CHANGED_OR_INACTIVE');
 if(r.requests.length)return reject('APPROVED_CHANGE_REQUEST_PENDING');
 const submission=r.submissions[0];if(!submission||!snapshot)return reject('APPROVED_SNAPSHOT_UNAVAILABLE');
 const [last,prior]=submission.reviews;
 const delta=new Date(change.occurredAt)-new Date(last?.createdAt);
 if(!last||last.outcome!=='APPROVAL_INVALIDATED'||last.reviewedByUserId!==edit.actorUserId||delta<0||delta>2000||new Date(last.createdAt)>new Date(edit.occurredAt)||new Date(last.createdAt)<new Date(edit.occurredAt)-30000||prior?.outcome!=='APPROVED')return reject('PREVIOUS_APPROVAL_NOT_PROVEN');
 if(new Date(submission.submittedAt)>=new Date(edit.occurredAt))return reject('NEW_SUBMISSION_AFTER_EDIT');
 if(!snapshot.event?.onboardingClosesAt?.startsWith('2026-11-12T'))return reject('SNAPSHOT_NOT_FROM_PRIOR_12_NOVEMBER_DEADLINE');
 const eventFields={id:event.id,name:event.name,startDate:iso(event.startDate),endDate:iso(event.endDate),onboardingOpensAt:iso(event.onboardingOpensAt),timezone:event.timezone};
 if(Object.entries(eventFields).some(([k,v])=>!eq(snapshot.event[k],v)))return reject('OTHER_EVENT_REQUIREMENTS_CHANGED');
 if(snapshot.registration?.id!==r.id||snapshot.registration.personnelLimit!==r.personnelLimit||snapshot.company?.id!==r.company.id||snapshot.company.name!==r.company.name||snapshot.company.internalOrganisation!==r.company.internalOrganisation)return reject('COMPANY_OR_CAPACITY_CHANGED');
 if(!eq(zones(r.zones),zones(snapshot.zones))||r.zones.some(z=>z.eventZone.deactivatedAt||z.eventZone.zone.deactivatedAt))return reject('ZONES_CHANGED_OR_INACTIVE');
 const vehicle=r.vehiclePass?{required:r.vehiclePass.required,requestedQuantity:r.vehiclePass.requestedQuantity,justification:r.vehiclePass.justification}:{required:false,requestedQuantity:0,justification:null};
 if(!eq(vehicle,snapshot.vehiclePass))return reject('VEHICLE_REQUEST_CHANGED');
 if(submission.photoAdjustments.some(p=>new Date(p.createdAt)>new Date(edit.occurredAt)))return reject('PHOTO_REVIEW_CHANGED_AFTER_EDIT');
 const people=r.participants.filter(p=>!['REMOVED','REPLACED'].includes(p.status));
 if(!people.length||people.length!==snapshot.participants?.length||new Set(people.map(p=>p.id)).size!==people.length)return reject('PARTICIPANT_SET_CHANGED');
 const approved=new Map(submission.participantReviews.filter(x=>x.outcome==='APPROVED').map(x=>[x.participantId,x]));
 if(submission.participantReviews.length!==people.length||approved.size!==people.length)return reject('INDIVIDUAL_AIA_APPROVALS_INCOMPLETE');
 const priorPeople=new Map(snapshot.participants.map(p=>[p.id,p]));let restoreWorkers=0;
 for(const person of people){
  const p=priorPeople.get(person.id);
  if(!p||p.status!=='LEADER_APPROVED'||person.erasedAt||person.jobRole?.deactivatedAt)return reject('PARTICIPANT_CHANGED_OR_INACTIVE');
  const values={fullName:person.fullName,dateOfBirth:iso(person.dateOfBirth),documentType:person.documentType,documentNumberCiphertext:person.documentNumberCiphertext,documentNumberIv:person.documentNumberIv,documentNumberAuthTag:person.documentNumberAuthTag,documentNumberKeyVersion:person.documentNumberKeyVersion,documentNumberFingerprint:person.documentNumberFingerprint,documentNumberLast3:person.documentNumberLast3,documentExpiryDate:iso(person.documentExpiryDate),mobileE164:person.mobileE164,nationalityCode:person.nationalityCode,photoObjectKey:person.photoObjectKey,privacyNoticeVersion:person.privacyNoticeVersion,privacyAcknowledgedAt:iso(person.privacyAcknowledgedAt),jobRole:person.jobRole?{id:person.jobRole.id,name:person.jobRole.name}:null};
  if(Object.entries(values).some(([k,v])=>!eq(v,p[k]))||!eq(person.workDays.map(d=>iso(d.workDate)).sort(),p.workDays.slice().sort())||!eq(zones(person.individualZones),zones(p.zones)))return reject('PARTICIPANT_CONTENT_CHANGED');
  const actions=postAudits.filter(a=>a.entityId===person.id);
  if(person.status==='AWAITING_LEADER_REVIEW'&&person.version===p.version+1&&actions.length===0)restoreWorkers++;
  else if(!(person.status==='LEADER_APPROVED'&&person.version===p.version+2&&actions.length===1&&actions[0].action==='PARTICIPANT_APPROVED'))return reject('PARTICIPANT_EDIT_OR_VERSION_NOT_EXPLAINED_BY_DEADLINE');
 }
 return {eligible:true,registrationId:r.id,submissionId:submission.id,previousApprovalId:prior.id,workerCount:people.length,restoreWorkers};
}
export function recoverySnapshot(original,r,event,recoveryId,performedAt){
 const copy=structuredClone(original);const people=new Map(r.participants.map(p=>[p.id,p]));
 copy.registration.version=r.version;
 copy.event.onboardingClosesAt=DEADLINE;
 copy.participants=copy.participants.map(p=>({...p,status:'LEADER_APPROVED',version:people.get(p.id).version+(people.get(p.id).status==='AWAITING_LEADER_REVIEW'?1:0)}));
 copy.operatorRecovery={kind:'DEADLINE_ONLY_APPROVAL_RESTORATION',recoveryId,eventAuditId:AUDIT,fromSubmissionId:r.submissions[0].id,performedAt,originalPrivacyEvidenceRetained:true};
 return copy;
}
