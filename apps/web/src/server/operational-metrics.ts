import "server-only";
import Redis from "ioredis";
import {parseEnv,createLogger} from "@aia/config";
const logger=createLogger();let client:Redis|undefined;
async function redis(){if(!client){client=new Redis(parseEnv(process.env).REDIS_URL,{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:2000,commandTimeout:2000});client.on("error",()=>{});}if(client.status==="wait")await client.connect();return client;}
export async function checkRedisReady(){await (await redis()).ping();}
export async function recordRequestFailure(){logger.error("REQUEST_FAILED");try{await (await redis()).multi().incr("aia:operations:request-errors:hour").expire("aia:operations:request-errors:hour",3600,"NX").exec();}catch{/* no request, exception, URL or token is logged */}}
export async function requestFailureCount(){return Number(await (await redis()).get("aia:operations:request-errors:hour")??0);}
