import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// A private ingress injects both headers after removing any client-supplied values.
export function publicSource(headers: Pick<Headers, "get">, proxySecret: string | undefined) {
  const supplied = headers.get("x-aia-proxy-secret") ?? "";
  if (!proxySecret || proxySecret.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(proxySecret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(proxySecret))) return "untrusted";
  const ip = headers.get("x-aia-client-ip") ?? "";
  return isIP(ip) ? ip : "untrusted";
}

export function sourceBucket(source: string) {
  // Fixed cardinality even if an attacker rotates IPs; collisions only tighten limits.
  return createHash("sha256").update(source).digest().readUInt16BE(0) % 4096;
}

export const RATE_LIMIT_SCRIPT = `
local global = redis.call('INCR', KEYS[1])
if global == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if global > tonumber(ARGV[2]) then return 0 end
local source = redis.call('INCR', KEYS[2])
if source == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
if source > tonumber(ARGV[3]) then return 0 end
return 1`;
