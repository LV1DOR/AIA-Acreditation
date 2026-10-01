import "server-only";
import { randomUUID } from "node:crypto";
import { MAX_EVENT_BANNER_BYTES, processEventBanner, scanWithClamAv } from "@aia/storage";
import { objectStorage, storageEnvironment } from "./storage.ts";

export async function storeEventBanner(eventId: string, file: File) {
  if (!(file instanceof File) || !file.size || file.size > MAX_EVENT_BANNER_BYTES) throw new Error("INVALID_BANNER");
  const input = new Uint8Array(await file.arrayBuffer());
  const environment = storageEnvironment();
  await scanWithClamAv(input, environment.CLAMAV_HOST, environment.CLAMAV_PORT);
  const processed = await processEventBanner(input, file.type);
  const key = `events/${eventId}/branding/${randomUUID()}.jpg`;
  const storage = objectStorage();
  await storage.ensureBucket();
  await storage.putPhoto(key, processed);
  return key;
}
