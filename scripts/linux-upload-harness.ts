// Isolated synthetic harness for the actual Phase 1 image/Lua/source controls; never a production route.
import {createServer} from "node:http";
import Redis from "ioredis";
import {processParticipantPhoto} from "../packages/storage/src/index.ts";
import {publicSource,sourceBucket,RATE_LIMIT_SCRIPT} from "../apps/web/src/server/public-request-policy.ts";
const redis=new Redis('redis://redis:6379',{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1});redis.on('error',()=>{});await redis.connect();
let received=0,decoded=0,busy=0,rejected=0;
const secret='SYNTHETIC-LOCAL-INGRESS-TEST-ONLY-00000000';
createServer(async(req,res)=>{
  const h=new Headers();for(const [k,v]of Object.entries(req.headers))if(typeof v==='string')h.set(k,v);
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const source=publicSource(h,secret),sourceHash=sourceBucket(source);
  if(req.url==='/status'){res.end(JSON.stringify({received,decoded,busy,rejected,sourceHash,node:process.version,rss:process.memoryUsage().rss,maxRss:process.resourceUsage().maxRSS*1024}));return;}
  if(req.url==='/reset'){await redis.del('aia:linux-test:global',`aia:linux-test:source:${sourceHash}`);received=decoded=busy=rejected=0;res.end('{}');return;}
  if(req.url!=='/upload'){res.writeHead(404).end('{}');return;}received++;
  if(Number(req.headers['content-length']??0)>8*1024*1024){req.resume();res.writeHead(413).end('{}');return;}
  try {
    if(await redis.eval(RATE_LIMIT_SCRIPT,2,'aia:linux-test:global',`aia:linux-test:source:${sourceHash}`,60,12,6)!==1){req.resume();res.writeHead(429).end('{}');return;}
    if(req.headers['x-synthetic-test-token']!=='synthetic-valid'){req.resume();rejected++;res.writeHead(404).end('{}');return;}
    const buffers:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>8*1024*1024){res.writeHead(413).end('{}');return;}buffers.push(b);}
    const input=Buffer.concat(buffers),out=await processParticipantPhoto(input,String(req.headers['content-type']));decoded++;res.end(JSON.stringify({bytes:out.length}));
  }catch(e){const overloaded=e instanceof Error && e.message==='IMAGE_PROCESSING_BUSY';if(overloaded)busy++;else rejected++;res.writeHead(overloaded?503:400).end('{}');}
}).listen(3000,'0.0.0.0');
