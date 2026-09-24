import "server-only";
import { MAX_PARTICIPANT_PHOTO_BYTES, processParticipantPhoto, scanWithClamAv } from "@aia/storage";
import { objectStorage, storageEnvironment } from "./storage.ts";

export function participantPhotoKey(eventId: string, registrationId: string, participantId: string) {
  return `photos/${eventId}/${registrationId}/${participantId}/profile.jpg`;
}

export async function storeParticipantPhoto(file: File, key: string) {
  if (!(file instanceof File) || !file.size) throw new Error("PHOTO_REQUIRED");
  if (file.size > MAX_PARTICIPANT_PHOTO_BYTES) throw new Error("INVALID_PHOTO");
  const input = new Uint8Array(await file.arrayBuffer());
  const environment = storageEnvironment();
  await scanWithClamAv(input, environment.CLAMAV_HOST, environment.CLAMAV_PORT);
  const processed = await processParticipantPhoto(input, file.type);
  const storage = objectStorage();
  await storage.ensureBucket();
  await storage.putPhoto(key, processed);
  return key;
}
