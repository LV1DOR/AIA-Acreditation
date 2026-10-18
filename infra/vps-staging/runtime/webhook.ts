// Exercise the real signature verifier and durable worker, entirely inside staging.
import {createHmac,randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {createDatabase} from '../packages/database/src/index.ts';
try {
 if(process.env.DEPLOYMENT_ENV!=='staging'||process.env.AIA_SYNTHETIC_DATA!=='true'||process.env.AIA_STAGE_PROJECT!=='aia-accreditation-staging')throw Error('TARGET');
 const u=new URL(process.env.DATABASE_URL!);if(u.hostname!=='postgres'||u.pathname!=='/aia_accreditation_staging')throw Error('DB');
 const db=createDatabase(u.toString());try {
  const marker=await db.$queryRawUnsafe<{marker:string}[]>("SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()");
  if(marker[0]?.marker!=='aia-accreditation-staging-synthetic-only')throw Error('MARKER');
 }finally{await db.$disconnect();}
 const secret=process.env.CLERK_WEBHOOK_SIGNING_SECRET!;if(!secret?.startsWith('whsec_'))throw Error('SECRET');
 const id='msg_'+randomUUID(),timestamp=String(Math.floor(Date.now()/1000)),subject='Synthetic signed webhook '+randomUUID();
 const body=JSON.stringify({object:'event',type:'email.created',data:{id:'email_'+randomUUID(),delivered_by_clerk:false,to_email_address:'synthetic-webhook@example.invalid',subject,body_plain:'SYNTHETIC ONLY',body:'<p>SYNTHETIC ONLY</p>'}});
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+body).digest('base64');
 const post=(sig:string)=>new Promise<number>((ok,no)=>{
  const req=request('https://ingress:8443/api/webhooks/clerk',{method:'POST',headers:{host:'localhost:18443',origin:'https://localhost:18443','content-type':'application/json','content-length':Buffer.byteLength(body),'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+sig}},res=>{res.resume();res.on('end',()=>ok(res.statusCode??0));});
  req.on('error',no);req.setTimeout(10000,()=>req.destroy(Error('TIMEOUT')));req.end(body);
 });
 if(await post(Buffer.alloc(32).toString('base64'))!==400)throw Error('INVALID_SIGNATURE_ACCEPTED');
 if(await post(signature)!==204)throw Error('SIGNED_WEBHOOK_FAILED');
 let delivered=false;
 for(let n=0;n<30;n++){
  const r=await fetch('http://mailpit:8025/api/v1/messages',{signal:AbortSignal.timeout(5000)});
  const m=await r.json() as {messages?:{Subject?:string}[]};
  if(m.messages?.some(x=>x.Subject===subject)){delivered=true;break;}await new Promise(r=>setTimeout(r,500));
 }
 if(!delivered)throw Error('MAILPIT_DELIVERY_FAILED');
 console.log('SIGNED_WEBHOOK_TO_WORKER_TO_MAILPIT_PASSED; invalid signature rejected; no external email.');
}catch{console.error('STAGING_WEBHOOK_TEST_FAILED');process.exitCode=1;}
