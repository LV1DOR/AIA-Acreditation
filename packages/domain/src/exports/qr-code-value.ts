import { z } from "zod";

/**
 * Produce the stable Base64 QR payload used by both print and WeBook exports.
 * EventParticipant IDs are UUIDs, so encoding their 16 bytes gives a unique,
 * deterministic 24-character Base64 value without storing a second identity.
 */
export function attendeeQrCodeValue(attendeeId: string): string {
  const uuid = z.uuid().parse(attendeeId).replaceAll("-", "");
  return Buffer.from(uuid, "hex").toString("base64");
}
