import "server-only";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import { config } from "dotenv";
import { parseEnv } from "@aia/config";
import { headers } from "next/headers";
import { publicSource, RATE_LIMIT_SCRIPT, sourceBucket } from "./public-request-policy.ts";

config({ path: "../../.env", quiet: true });
let redis: Redis | undefined;

async function connection() {
  if (!redis) {
    redis = new Redis(parseEnv(process.env).REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000 });
    redis.on("error", () => { /* fail closed without logging request or dependency secrets */ });
  }
  if (redis.status === "wait") await redis.connect();
  return redis;
}

export async function enforcePublicRequestLimit(scope: "employee-view" | "employee-submit" | "invitation-start") {
  const client = await connection();
  const source = publicSource(await headers(), process.env.AIA_PROXY_SECRET);
  const allowed = await client.eval(RATE_LIMIT_SCRIPT, 2, `aia:rate:${scope}:global`, `aia:rate:${scope}:source:${sourceBucket(source)}`, 60, scope === "employee-view" ? 1200 : 600, scope === "employee-view" ? 120 : 60);
  if (allowed !== 1) throw new Error("RATE_LIMITED");
}

export async function enforcePublicRateLimit(scope: string, identifier: string, limit = 10, windowSeconds = 900) {
  const redis = await connection();
  const digest = createHash("sha256").update(identifier).digest("hex");
  const key = `aia:rate:${scope}:${digest}`;
  const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, windowSeconds) as number;
  if (count > limit) throw new Error("RATE_LIMITED");
}
