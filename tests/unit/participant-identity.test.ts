import { expect, it } from "vitest";
import { normalizeDocumentNumber, protectDocumentNumber, revealDocumentNumber } from "../../packages/domain/src/index.ts";
import { MAX_PARTICIPANT_PHOTO_BYTES, processParticipantPhoto } from "../../packages/storage/src/index.ts";

const encryptionKey = "11".repeat(32);
const fingerprintKey = "22".repeat(32);

it("normalizes equivalent document numbers and fingerprints type plus normalized value", () => {
  expect(normalizeDocumentNumber(" ab-12. 34/xy ")).toBe("AB1234XY");
  const first = protectDocumentNumber("PASSPORT", "ab-12 34", "00000000-0000-4000-8000-000000000001", encryptionKey, fingerprintKey);
  const second = protectDocumentNumber("PASSPORT", " AB.1234 ", "00000000-0000-4000-8000-000000000002", encryptionKey, fingerprintKey);
  const otherType = protectDocumentNumber("CARTAO_CIDADAO", "AB1234", "00000000-0000-4000-8000-000000000003", encryptionKey, fingerprintKey);
  expect(first.documentNumberFingerprint).toBe(second.documentNumberFingerprint);
  expect(first.documentNumberFingerprint).not.toBe(otherType.documentNumberFingerprint);
  expect(first.documentNumberCiphertext).not.toContain("ab-12 34");
  expect(first.documentNumberLast3).toBe("234");
  expect(revealDocumentNumber({ id: "00000000-0000-4000-8000-000000000001", ...first }, encryptionKey)).toBe("ab-12 34");
});

it("rejects malformed photos and emits a processed JPEG", async () => {
  expect(MAX_PARTICIPANT_PHOTO_BYTES).toBe(8 * 1024 * 1024);
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const processed = await processParticipantPhoto(onePixelPng, "image/png");
  expect([...processed.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  await expect(processParticipantPhoto(Buffer.from("not an image"), "image/png")).rejects.toThrow("INVALID_PHOTO");
  await expect(processParticipantPhoto(onePixelPng, "image/svg+xml")).rejects.toThrow("INVALID_PHOTO");
});
