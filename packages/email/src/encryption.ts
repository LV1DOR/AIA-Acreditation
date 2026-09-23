import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
const envelope = z.object({ version: z.literal(1), iv: z.string(), tag: z.string(), ciphertext: z.string() }).strict();
function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("INVALID_EMAIL_ENCRYPTION_KEY");
  return Buffer.from(key, "hex");
}
export function encryptEmail(value: unknown, key: string, id: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") };
}
export function decryptEmail(value: unknown, key: string, id: string): unknown {
  const data = envelope.parse(value), decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(data.iv, "base64"));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
