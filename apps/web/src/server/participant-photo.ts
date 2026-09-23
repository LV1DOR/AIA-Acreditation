import "server-only";
import { processParticipantPhoto, scanWithClamAv } from "@aia/storage";
import { objectStorage, storageEnvironment } from "./storage.ts";

export function participantPhotoKey(eventId: string, registrationId: string, participantId: string) {
  return `photos/${eventId}/${registrationId}/${participantId}/profile.jpg`;
}

export async function storeParticipantPhoto(file: File, key: string) {
  if (!(file instanceof File) || !file.size) throw new Error("PHOTO_REQUIRED");
  const input = new Uint8Array(await file.arrayBuffer());
  const environment = storageEnvironment();
  await scanWithClamAv(input, environment.CLAMAV_HOST, environment.CLAMAV_PORT);
  const processed = await processParticipantPhoto(input, file.type);
  const storage = objectStorage();
  await storage.ensureBucket();
  await storage.putPhoto(key, processed);
  return key;
}
