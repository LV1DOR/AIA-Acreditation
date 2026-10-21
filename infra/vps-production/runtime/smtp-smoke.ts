// Exactly one controlled existing bilingual template; no queue scan or bulk recipient list.
import {randomUUID} from 'node:crypto';
import {parseEnv} from '../packages/config/src/index.ts';
import {createSmtpTransport,renderBusinessEmail} from '../packages/email/src/index.ts';
import {check,safe} from './guard.ts';
await safe(async()=>{
  check(process.env.DEPLOYMENT_ENV==='production'&&process.env.AIA_SMTP_SMOKE_CONFIRM==='SEND_ONE_CONTROLLED_MESSAGE','EXPLICIT_SINGLE_SEND_APPROVAL_REQUIRED');
  const e=parseEnv(process.env),to=process.env.AIA_SMTP_SMOKE_RECIPIENT;
  check(to&&to===process.env.AIA_SMTP_SMOKE_ALLOWED_RECIPIENT&&/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(to),'SINGLE_ALLOWED_RECIPIENT_REQUIRED');
  check(e.SMTP_HOST==='smtp.resend.com'&&e.SMTP_PORT===2465&&e.SMTP_SECURE&&e.SMTP_FROM==='notificacoes@notify.joinaia.pt','RESEND_SMTP_CONFIGURATION_REQUIRED');
  const t=createSmtpTransport({host:e.SMTP_HOST,port:e.SMTP_PORT,secure:e.SMTP_SECURE,from:e.SMTP_FROM,user:e.SMTP_USER,password:e.SMTP_PASSWORD});
  try{const body=await renderBusinessEmail('STATUS_UPDATE',{companyName:'AIA — teste técnico controlado / controlled technical test',eventName:'Verificação SMTP / SMTP verification',appUrl:'https://app.joinaia.pt/portal'});await t.send({deliveryId:randomUUID(),to,...body});console.log(JSON.stringify({accepted:true,inboxVerified:false,displayNameSupported:false,replyToSupported:false}));}finally{t.close();}
});
