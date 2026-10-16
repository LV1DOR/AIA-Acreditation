import {createServer,connect,type Socket} from 'node:net';
import {spawn} from 'node:child_process';
if(process.env.DEPLOYMENT_ENV!=='test'||process.env.AIA_PHASE4A_SYNTHETIC_REHEARSAL!=='true'||!process.env.AIA_STAGE_PROJECT?.startsWith('aia-accreditation-phase4a-'))throw Error('SYNTHETIC_LINUX_TEST_RUNNER_REQUIRED');
const sockets=new Set<Socket>(),servers=[];
for(const [port,host,target]of [[16432,'postgres',5432],[16379,'redis',6379],[19000,'minio',9000],[11025,'mailpit',1025],[18025,'mailpit',8025]] as const){const server=createServer(client=>{const upstream=connect(target,host);for(const socket of [client,upstream]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{client.destroy();upstream.destroy();});}client.pipe(upstream);upstream.pipe(client);});await new Promise<void>((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});servers.push(server);}
process.env.REDIS_URL=process.env.REDIS_URL!.replace('rediss://aia:','rediss://aia_test:');
const run=(args:string[])=>new Promise<void>((r,j)=>{const p=spawn(process.execPath,args,{stdio:'inherit',env:process.env});p.once('error',j);p.once('exit',code=>code===0?r():j(Error('LINUX_REGRESSION_FAILED')));});
try {await run(['--import','tsx','scripts/phase1-test-migrate.ts']);await run(['node_modules/vitest/vitest.mjs','run','--project','unit']);await run(['node_modules/vitest/vitest.mjs','run','--project','integration']);}
finally {for(const s of sockets)s.destroy();await Promise.all(servers.map(s=>new Promise<void>(r=>s.close(()=>r()))));}
