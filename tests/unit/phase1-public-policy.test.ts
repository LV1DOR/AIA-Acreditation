import { expect, it } from "vitest";
import { publicSource, sourceBucket } from "../../apps/web/src/server/public-request-policy.ts";

it("F05 ignores forwarded IPs and unsigned ingress headers", () => {
  const headers = new Headers({ "x-forwarded-for": "192.0.2.1", "x-aia-client-ip": "192.0.2.2", "x-aia-proxy-secret": "attacker" });
  expect(publicSource(headers, undefined)).toBe("untrusted");
  expect(publicSource(headers, "a".repeat(32))).toBe("untrusted");
});
it("F05 accepts only secret-authenticated ingress IPs and limits source key cardinality", () => {
  const headers = new Headers({ "x-aia-client-ip": "192.0.2.2", "x-aia-proxy-secret": "a".repeat(32) });
  expect(publicSource(headers, "a".repeat(32))).toBe("192.0.2.2");
  headers.set("x-aia-client-ip", "192.0.2.2, 192.0.2.3");
  expect(publicSource(headers, "a".repeat(32))).toBe("untrusted");
  const buckets = new Set(Array.from({ length: 20_000 }, (_, i) => sourceBucket(`synthetic-${i}`)));
  expect(buckets.size).toBeLessThanOrEqual(4096);
});
