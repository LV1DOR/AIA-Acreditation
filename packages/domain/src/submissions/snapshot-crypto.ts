import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const envelope = z.object({ version: z.literal(1), algorithm: z.literal("AES-256-GCM"), iv: z.string(), tag: z.string(), ciphertext: z.string() }).strict();

function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("INVALID_SUBMISSION_ENCRYPTION_KEY");
  return Buffer.from(key, "hex");
}

export function encryptSubmissionSnapshot(serialized: string, key: string, submissionId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(`company-submission:${submissionId}:v1`));
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
  return { version: 1 as const, algorithm: "AES-256-GCM" as const, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptSubmissionSnapshot(value: unknown, key: string, submissionId: string): unknown {
  const data = envelope.parse(value);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(data.iv, "base64"));
  decipher.setAAD(Buffer.from(`company-submission:${submissionId}:v1`));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
}
