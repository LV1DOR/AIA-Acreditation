import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { expect, it } from "vitest";
import { parseStorageEnv } from "../../packages/config/src/index.ts";
import { createObjectStorage } from "../../packages/storage/src/index.ts";

config({ path: ".env", quiet: true });

it("keeps processed photos in the private local object store", async () => {
  const environment = parseStorageEnv(process.env);
  const storage = createObjectStorage({
    endpoint: environment.MINIO_ENDPOINT,
    accessKey: environment.MINIO_ACCESS_KEY,
    secretKey: environment.MINIO_SECRET_KEY,
    bucket: environment.MINIO_PHOTOS_BUCKET,
    region: environment.MINIO_REGION,
  });
  const key = `integration/${randomUUID()}.jpg`;
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  await storage.ensureBucket();
  await storage.putPhoto(key, bytes);
  expect(await storage.getPhoto(key)).toEqual(bytes);
  await storage.deletePhoto(key);
  await expect(storage.getPhoto(key)).rejects.toThrow();
});
