import {createDatabase} from './packages/database/src/index.ts';
import {parseEnv,parseAuthEnv} from './packages/config/src/index.ts';
import {createSmtpTransport,prepareSmtpMessage} from './packages/email/src/index.ts';
import {createClerkClient} from '@clerk/backend';
import {target,marked} from './production-ops/guard.ts';
import {EVENT,AUDIT,CORRELATION,CAMPAIGN,subject,text,html,digest,id,included,uniqueRecipients,ledgerState} from './deadline_notice.mjs';
const db=createDatabase(process.env.DATABASE_URL!);let transport:any;let accepted=0,skipped=0;
try{
 if(process.env.AIA_NOTICE_APPROVAL!=='SEND_APPROVED_BILINGUAL_NOTICE')throw Error('EXPLICIT_EMAIL_APPROVAL_REQUIRED');
 target(process.env.DATABASE_URL,'aia_web');await marked(db);
 const e=parseEnv(process.env),auth=parseAuthEnv(process.env);
 if(!auth.CLERK_SECRET_KEY||e.SMTP_HOST!=='smtp.resend.com'||e.SMTP_PORT!==2465||!e.SMTP_SECURE||e.SMTP_FROM!=='notificacoes@notify.joinaia.pt')throw Error('EXISTING_PRODUCTION_MAIL_CONFIGURATION_REQUIRED');
 const event=await db.event.findUniqueOrThrow({where:{id:EVENT}}),edit=await db.auditEvent.findUniqueOrThrow({where:{id:AUDIT}});
 if(event.name!=='MotoGP Portugal 2026'||event.onboardingClosesAt.toISOString()!=='2026-11-10T23:55:00.000Z'||edit.correlationId!==CORRELATION||edit.eventId!==EVENT)throw Error('EXACT_DEADLINE_EVENT_REQUIRED');
 const changes=await db.auditEvent.findMany({where:{eventId:EVENT,correlationId:CORRELATION,action:'APPROVAL_INVALIDATED',entityType:'CompanyEventRegistration'}});
 const regs=await db.companyEventRegistration.findMany({where:{eventId:EVENT,erasedAt:null,withdrawnAt:null},include:{company:true,primaryLeader:{include:{user:true}},submissions:{include:{reviews:true}}}});
 const selected=regs.filter(r=>included(r,changes.find(c=>c.entityId===r.id),edit));
 if(!selected.length||selected.length>100)throw Error('BOUNDED_APPROVED_COMPANY_SCOPE_REQUIRED');
 const clerk=createClerkClient({secretKey:auth.CLERK_SECRET_KEY});const resolved=[];
 // Resolve and validate the entire list before sending anything. No addresses in output.
 for(const r of selected){
  const leader=r.primaryLeader;
  if(!leader||leader.revokedAt||leader.companyId!==r.companyId||leader.user.disabledAt||leader.user.role!=='COMPANY_LEADER')throw Error('ACTIVE_PRIMARY_COMPANY_LEADER_REQUIRED');
  const user=await clerk.users.getUser(leader.user.clerkUserId);
  if(user.banned||user.locked)throw Error('ACTIVE_CLERK_RECIPIENT_REQUIRED');
  const verified=user.emailAddresses.filter(a=>a.verification?.status==='verified');
  const address=verified.find(a=>a.id===user.primaryEmailAddressId)??verified[0];
  if(!address)throw Error('VERIFIED_LEADER_EMAIL_REQUIRED');
  resolved.push({email:address.emailAddress,registrationId:r.id});
 }
 const recipients=uniqueRecipients(resolved);
 for(const r of recipients){
  const key=digest(r.email.toLowerCase()),deliveryId=id('delivery',key);
  await prepareSmtpMessage({deliveryId,to:r.email,subject,text,html},e.SMTP_FROM);
  const claim=await db.auditEvent.findUnique({where:{id:id('claim',key)}});
  const receipt=await db.auditEvent.findUnique({where:{id:id('accepted',key)}});
  ledgerState(claim,receipt);
 }
 console.log(JSON.stringify({stage:'BILINGUAL_NOTICE_PREFLIGHT',approvedCompanies:selected.length,uniqueVerifiedMailboxes:recipients.length,recipientAddressesPrinted:false,recoveryStatusChanged:false}));
 transport=createSmtpTransport({host:e.SMTP_HOST,port:e.SMTP_PORT,secure:e.SMTP_SECURE,from:e.SMTP_FROM,user:e.SMTP_USER,password:e.SMTP_PASSWORD});
 for(const r of recipients){
  const key=digest(r.email.toLowerCase()),claimId=id('claim',key),acceptedId=id('accepted',key);
  if(await db.auditEvent.findUnique({where:{id:acceptedId}})){skipped++;continue;}
  // Unique primary key claims BEFORE SMTP. Any uncertain result blocks automatic retry.
  await db.auditEvent.create({data:{id:claimId,actorType:'SYSTEM',action:'OPERATOR_DEADLINE_NOTICE_CLAIMED',entityType:'Event',entityId:EVENT,eventId:EVENT,correlationId:id('campaign',EVENT),metadata:{campaign:CAMPAIGN,recipientSha256:key,registrationIds:r.registrationIds,contentSha256:digest(subject+'\n'+text),operatorAuthorised:true}}});
  await transport.send({deliveryId:id('delivery',key),to:r.email,subject,text,html});
  await db.auditEvent.create({data:{id:acceptedId,actorType:'SYSTEM',action:'OPERATOR_DEADLINE_NOTICE_ACCEPTED',entityType:'Event',entityId:EVENT,eventId:EVENT,correlationId:id('campaign',EVENT),metadata:{campaign:CAMPAIGN,recipientSha256:key,claimId,provider:'resend-smtp',inboxDeliveryVerified:false}}});
  accepted++;console.log(JSON.stringify({stage:'NOTICE_SMTP_ACCEPTED',acceptedThisRun:accepted}));
 }
 console.log(JSON.stringify({passed:true,campaign:CAMPAIGN,acceptedThisRun:accepted,alreadyAccepted:skipped,inboxDeliveryVerified:false,servicesChanged:false}));
}catch(error){const code=error instanceof Error&&/^[A-Z0-9_]{4,100}$/.test(error.message)?error.message:'NOTICE_FAILED_DETAILS_SUPPRESSED_INSPECT_BEFORE_RETRY';console.log(JSON.stringify({passed:false,code,acceptedThisRun:accepted,alreadyAccepted:skipped}));process.exitCode=1;}
finally{transport?.close();await db.$disconnect();}
