import { createServer } from "node:http";
import type { PrismaClient } from "@aia/database";
export function healthServer(db: PrismaClient, redisReady: () => boolean = () => true, storageReady:()=>Promise<void>=async()=>{}) {
  return createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/api/health/live") { response.end('{"status":"alive"}'); return; }
    if (request.url !== "/api/health/ready") { response.writeHead(404).end(); return; }
    try { await db.$queryRaw`SELECT 1`; await storageReady(); if (!redisReady()) throw new Error("REDIS_UNAVAILABLE"); response.end('{"status":"ready"}'); }
    catch { response.writeHead(503).end('{"status":"unavailable"}'); }
  });
}
