// Independent of the database/outbox so database failures can still alert the operator.
import {randomUUID} from 'node:crypto';
import {parseEnv} from '../packages/config/src/index.ts';
import {createSmtpTransport} from '../packages/email/src/index.ts';
import {check,safe} from './guard.ts';
await safe(async()=>{
  check(process.env.DEPLOYMENT_ENV==='production','PRODUCTION_MONITOR_REQUIRED');
  const to=process.env.AIA_MONITOR_RECIPIENT,codes=(process.env.AIA_MONITOR_ALERT_CODES??'').split(',');
  check(to&&/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(to)&&codes.length<=30&&codes.every(x=>/^[A-Z0-9_]{4,80}$/.test(x)),'CONTROLLED_ALERT_INPUT_REQUIRED');
  const e=parseEnv(process.env),t=createSmtpTransport({host:e.SMTP_HOST,port:e.SMTP_PORT,secure:e.SMTP_SECURE,from:e.SMTP_FROM,user:e.SMTP_USER,password:e.SMTP_PASSWORD});
  try{const text='AIA Accreditation production operational alert.\n'+codes.join('\n')+'\nInspect the protected production runbook. No personal data is included.';await t.send({deliveryId:randomUUID(),to,subject:'AIA Accreditation — operational alert',text,html:'<p>AIA Accreditation production operational alert.</p><pre>'+codes.join('\n')+'</pre>'});console.log('OPERATOR_ALERT_ACCEPTED_INBOX_CONFIRMATION_REQUIRED');}finally{t.close();}
});
