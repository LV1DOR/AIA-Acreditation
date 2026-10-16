import {expect,it,afterAll} from "vitest";
import {spawn,spawnSync} from "node:child_process";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
import {db} from "./database.ts";
import {fixture} from "../fixtures/foundation.ts";
import {transaction} from "../../packages/domain/src/shared/transaction.ts";
import {queueBusinessEmail,enqueueAuthEmail,reconcileExpiredDeliveryLeases} from "../../packages/domain/src/index.ts";
afterAll(()=>db.$disconnect());
it('F17 an actual claim process crash persists the final lease and reconciles after expiry',async()=>{
  const f=await fixture(db),key='phase3-actual-crash:'+randomUUID();await transaction(db,tx=>queueBusinessEmail(tx,key,{registrationId:f.registration.id,recipientUserId:f.leader.id,template:'STATUS_UPDATE',companyName:f.company.name,eventName:f.event.name,path:'/portal'}));const m=await db.outboxMessage.update({where:{deduplicationKey:key},data:{attempts:7,availableAt:new Date(0)}});
  const child=spawn(process.execPath,['--import','tsx','scripts/phase3-claim-crash.ts',m.id],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stderr.resume();
  try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLAIM_TIMEOUT')),8000);child.stdout.on('data',data=>{if(String(data).includes('CLAIM_COMMITTED')){clearTimeout(timer);resolve();}});child.once('error',reject);});const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGKILL');await exited;
    expect((await db.outboxMessage.findUniqueOrThrow({where:{id:m.id}})).attempts).toBe(8);await db.outboxMessage.update({where:{id:m.id},data:{leaseExpiresAt:new Date(0)}});await reconcileExpiredDeliveryLeases(db);expect((await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:m.id}})).status).toBe('UNKNOWN');
  }finally{if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');}
});
it('F17 the built worker drains an in-flight SMTP send on the PM2 shutdown message before disconnecting',async()=>{
  const built=spawnSync('corepack pnpm --filter @aia/worker build',{shell:true,windowsHide:true,stdio:'pipe',env:{...process.env,WORKER_DIST_DIR:'.candidate-phase3-tests'}});if(built.status!==0)throw Error('WORKER_TEST_BUILD_FAILED');
  let release:()=>void=()=>{},receivedResolve:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;}),received=new Promise<void>(r=>{receivedResolve=r;});
  const sockets=new Set<import('node:net').Socket>();const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 synthetic.local ESMTP\r\n');let pending='',dataMode=false;
    socket.on('data',chunk=>{pending+=chunk.toString();for(;;){const end=pending.indexOf('\r\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+2);if(dataMode){if(line==='.') {dataMode=false;receivedResolve();void gate.then(()=>socket.write('250 synthetic accepted\r\n'));}continue;}if(/^EHLO|^HELO/.test(line))socket.write('250 synthetic.local\r\n');else if(line==='DATA'){dataMode=true;socket.write('354 synthetic input\r\n');}else if(line==='QUIT'){socket.end('221 bye\r\n');}else socket.write('250 synthetic ok\r\n');}});
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as import('node:net').AddressInfo).port;
  const eventId=randomUUID(),key='3'.repeat(64);await enqueueAuthEmail(db,{eventId,recipient:'synthetic-shutdown@example.invalid',subject:'Synthetic shutdown',text:'SYNTHETIC ONLY',html:'<p>SYNTHETIC ONLY</p>'},key);const row=await db.outboxMessage.findFirstOrThrow({where:{type:'AUTH_EMAIL',processedAt:null,terminalAt:null},orderBy:{createdAt:'desc'}});await db.outboxMessage.update({where:{id:row.id},data:{availableAt:new Date(0)}});
  const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,DEBUG:'',DEPLOYMENT_ENV:'test',AIA_SYNTHETIC_DATA:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(port),SMTP_SECURE:'false',WORKER_HEALTH_PORT:'3298',CLERK_SECRET_KEY:'',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'',CLERK_WEBHOOK_SIGNING_SECRET:'',AUTH_EMAIL_ENCRYPTION_KEY:key,PRIVACY_DATABASE_URL:'',MINIO_PHOTOS_BUCKET:'aia-phase1-synthetic'};delete env.SMTP_USER;delete env.SMTP_PASSWORD;
  const child=spawn(process.execPath,['.candidate-phase3-tests/main.js'],{cwd:'apps/worker',windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env});let exited=false;const exit=new Promise<number|null>(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
  try{await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('SMTP_INFLIGHT_TIMEOUT')),8000))]);child.send('shutdown');await new Promise(r=>setTimeout(r,100));expect(exited).toBe(false);release();expect(await exit).toBe(0);expect((await db.emailDelivery.findUniqueOrThrow({where:{outboxMessageId:row.id}})).status).toBe('SENT');}
  finally{release();if(!exited)child.kill('SIGKILL');for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
