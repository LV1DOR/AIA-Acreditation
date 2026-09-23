import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { encryptEmail, decryptEmail } from "../../packages/email/src/encryption.ts";
it("authenticates encrypted payloads and binds each to its outbox row", () => {
  const key = randomBytes(32).toString("hex"), body = { token: "SYNTHETIC_SECRET_OTP" };
  const encrypted = encryptEmail(body, key, "row-1");
  expect(JSON.stringify(encrypted)).not.toContain("SYNTHETIC_SECRET_OTP");
  expect(decryptEmail(encrypted, key, "row-1")).toEqual(body);
  expect(() => decryptEmail(encrypted, key, "row-2")).toThrow();
  expect(() => decryptEmail(encrypted, randomBytes(32).toString("hex"), "row-1")).toThrow();
});

