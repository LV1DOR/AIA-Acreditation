import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { DocumentType } from "@aia/database";

function key(value: string, code: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(code);
  return Buffer.from(value, "hex");
}

export function normalizeDocumentNumber(value: string) {
  const normalized = value.normalize("NFKC").trim().toUpperCase().replace(/[\s\-./]/g, "");
  if (!/^[\p{L}\p{N}]{3,64}$/u.test(normalized)) throw new Error("INVALID_DOCUMENT_NUMBER");
  return normalized;
}

export function protectDocumentNumber(documentType: DocumentType, value: string, participantId: string, encryptionKey: string, fingerprintKey: string) {
  const normalized = normalizeDocumentNumber(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(encryptionKey, "INVALID_DOCUMENT_ENCRYPTION_KEY"), iv);
  cipher.setAAD(Buffer.from(participantId));
  const encrypted = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
  return {
    documentNumberCiphertext: encrypted.toString("base64"),
    documentNumberIv: iv.toString("base64"),
    documentNumberAuthTag: cipher.getAuthTag().toString("base64"),
    documentNumberKeyVersion: 1,
    documentNumberFingerprint: createHmac("sha256", key(fingerprintKey, "INVALID_DOCUMENT_FINGERPRINT_KEY")).update(`${documentType}:${normalized}`).digest("hex"),
    documentNumberLast3: normalized.slice(-3),
  };
}

export function revealDocumentNumber(value: {
  id: string;
  documentNumberCiphertext: string | null;
  documentNumberIv: string | null;
  documentNumberAuthTag: string | null;
  documentNumberKeyVersion: number | null;
}, encryptionKey: string) {
  const { documentNumberCiphertext: ciphertext, documentNumberIv: iv, documentNumberAuthTag: authTag, documentNumberKeyVersion: keyVersion } = value;
  if (!ciphertext && !iv && !authTag && !keyVersion) return null;
  if (!ciphertext || !iv || !authTag || keyVersion !== 1) throw new Error("INVALID_ENCRYPTED_DOCUMENT_NUMBER");
  const decipher = createDecipheriv("aes-256-gcm", key(encryptionKey, "INVALID_DOCUMENT_ENCRYPTION_KEY"), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(value.id));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
