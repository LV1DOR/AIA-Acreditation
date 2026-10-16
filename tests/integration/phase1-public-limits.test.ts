import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { expect, it } from "vitest";
import { RATE_LIMIT_SCRIPT, sourceBucket } from "../../apps/web/src/server/public-request-policy.ts";

type RedisClient = {
  eval(script: string, keyCount: number, ...values: (string | number)[]): Promise<number>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
};
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const Redis = require("ioredis") as new (url: string) => RedisClient;
config({ path: ".env", quiet: true });

it("F05 Redis atomically throttles one source and aggregate distinct sources, without token-key growth", async () => {
  const url = process.env.REDIS_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || new URL(url).port !== "16379") throw new Error("ISOLATED_LOCAL_REDIS_REQUIRED");
  const client = new Redis(url);
  const prefix = `aia:test:phase1:${randomUUID()}`;
  const global = `${prefix}:global`;
  const call = (source: string) => client.eval(RATE_LIMIT_SCRIPT, 2, global, `${prefix}:${sourceBucket(source)}`, 60, 6, 2);
  try {
    expect(await call("synthetic-one")).toBe(1);
    expect(await call("synthetic-one")).toBe(1);
    expect(await call("synthetic-one")).toBe(0);
    const results = await Promise.all(["two", "three", "four", "five"].map(call));
    expect(results.filter(result => result === 1)).toHaveLength(3);
    expect(await call("fresh-source-with-distinct-token")).toBe(0);
    const keys = await client.keys(`${prefix}:*`);
    expect(keys.length).toBeLessThanOrEqual(5);
    expect(await client.ttl(global)).toBeGreaterThan(0);
    for (const key of keys) expect(await client.ttl(key)).toBeGreaterThan(0);
  } finally {
    const keys = await client.keys(`${prefix}:*`);
    if (keys.length) await client.del(...keys);
    await client.quit();
  }
});
