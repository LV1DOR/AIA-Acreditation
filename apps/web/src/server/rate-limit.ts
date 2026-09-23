import "server-only";
import { createHash } from "node:crypto";
import Redis from "ioredis";
import { config } from "dotenv";
import { parseEnv } from "@aia/config";

config({ path: "../../.env", quiet: true });
let redis: Redis | undefined;

export async function enforcePublicRateLimit(scope: string, identifier: string, limit = 10, windowSeconds = 900) {
  redis ??= new Redis(parseEnv(process.env).REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  if (redis.status === "wait") await redis.connect();
  const digest = createHash("sha256").update(identifier).digest("hex");
  const key = `aia:rate:${scope}:${digest}`;
  const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, windowSeconds) as number;
  if (count > limit) throw new Error("RATE_LIMITED");
}
