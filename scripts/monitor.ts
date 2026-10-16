import {config} from "dotenv";
import {readFile,statfs} from "node:fs/promises";
import Redis from "ioredis";
import {createDatabase} from "../packages/database/src/index.ts";
import {parseEnv,parseStorageEnv} from "../packages/config/src/index.ts";
import {createObjectStorage} from "../packages/storage/src/object-storage.ts";
import {operationalSignals} from "../packages/domain/src/index.ts";
import {validateDatabaseTarget,type Target} from "./lib/targets.ts";
import {connect as connectTls} from 'node:tls';
config({quiet:true});const file=process.argv[2];if(!file)throw new Error('MONITOR_TARGET_FILE_REQUIRED');const target=JSON.parse(await readFile(file,'utf8')) as Target;
const e=parseEnv(process.env),s=parseStorageEnv(process.env);validateDatabaseTarget(e.DATABASE_URL,target);const db=createDatabase(e.DATABASE_URL),redis=new Redis(e.REDIS_URL,{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:2000,commandTimeout:2000});redis.on('error',()=>{});
const check=async(work:()=>Promise<unknown>)=>{try{await work();return true;}catch{return false;}};
try {
  const postgres=await check(()=>db.$queryRaw`SELECT 1`),redisReady=await check(async()=>{await redis.connect();await redis.ping();}),storage=createObjectStorage({endpoint:s.MINIO_ENDPOINT,accessKey:s.MINIO_ACCESS_KEY,secretKey:s.MINIO_SECRET_KEY,bucket:s.MINIO_PHOTOS_BUCKET,region:s.MINIO_REGION}),minio=await check(()=>storage.checkReady(target.environment==='production'));
  const availability:Record<string,boolean>={postgres,redis:redisReady,minio};for(const [name,origin]of [['web',process.env.MONITOR_WEB_ORIGIN],['worker',process.env.MONITOR_WORKER_ORIGIN]] as const)availability[name]=Boolean(origin)&&await check(async()=>{const r=await fetch(new URL('/api/health/ready',origin),{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('UNAVAILABLE');});
  const signals=postgres?await operationalSignals(db,{backupMaxAgeHours:Number(process.env.BACKUP_MAX_AGE_HOURS)||24,queueMaxAgeMinutes:Number(process.env.QUEUE_MAX_AGE_MINUTES)||15}):null;
  const disks=[];for(const [name,path]of [['application',process.cwd()],['database',process.env.MONITOR_POSTGRES_DATA_PATH],['objects',process.env.MONITOR_MINIO_DATA_PATH],['backups',process.env.BACKUP_DESTINATION]] as const){if(!path){disks.push({name,configured:false});continue;}try{const f=await statfs(path);disks.push({name,configured:true,freeBytes:f.bavail*f.bsize,totalBytes:f.blocks*f.bsize,lowSpace:f.bavail/f.blocks<0.1});}catch{disks.push({name,configured:true,unavailable:true});}}
  let objectCapacity:unknown={unavailable:true};if(minio){const listed=await storage.listObjects('',100000);objectCapacity={currentObjects:listed.objects.length,currentBytes:listed.objects.reduce((n,o)=>n+o.size,0),truncated:listed.truncated,physicalCapacityRequiresVolumeOrProviderMonitor:true};}
  const requestErrors=redisReady?Number(await redis.get('aia:operations:request-errors:hour')??0):null;
  const alerts=[...signals?.alerts??[],...Object.entries(availability).filter(([,ok])=>!ok).map(([name])=>name.toUpperCase()+'_UNAVAILABLE')];if(disks.some(d=>'lowSpace' in d&&d.lowSpace))alerts.push('DISK_SPACE_LOW');if(disks.some(d=>!d.configured))alerts.push('STORAGE_CAPACITY_MONITOR_INCOMPLETE');if(requestErrors!==null&&requestErrors>Number(process.env.REQUEST_ERROR_ALERT_THRESHOLD??10))alerts.push('REQUEST_ERRORS_REPEATED');
  let tls:unknown={configured:false};
  if(process.env.MONITOR_TLS_ORIGIN){try{const u=new URL(process.env.MONITOR_TLS_ORIGIN);if(u.protocol!=='https:'||u.username||u.password)throw Error('INVALID_TLS_ORIGIN');const expiresAt=await new Promise<Date>((ok,no)=>{const socket=connectTls({host:u.hostname,port:Number(u.port||443),servername:u.hostname,rejectUnauthorized:true},()=>{const date=new Date(socket.getPeerCertificate().valid_to);socket.end();if(Number.isFinite(date.getTime()))ok(date);else no(Error('INVALID_CERTIFICATE_DATE'));});socket.setTimeout(4000,()=>socket.destroy(Error('TLS_TIMEOUT')));socket.once('error',no);});const remainingDays=(expiresAt.getTime()-Date.now())/86400000;tls={configured:true,verified:true,expiresAt:expiresAt.toISOString(),remainingDays:Math.floor(remainingDays)};if(remainingDays<Number(process.env.MONITOR_TLS_MIN_VALID_DAYS??14))alerts.push('TLS_CERTIFICATE_EXPIRING');}catch{tls={configured:true,verified:false};alerts.push('TLS_CHECK_FAILED');}}else alerts.push('TLS_MONITOR_MISSING');
  console.log(JSON.stringify({availability,signals,disks,objectCapacity,requestErrors,tls,alerts}));process.exitCode=alerts.length?1:0;
}finally{redis.disconnect();await db.$disconnect();}
