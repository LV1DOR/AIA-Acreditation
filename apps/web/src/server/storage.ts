import "server-only";
import { config } from "dotenv";
import { inspectStorageEnv } from "@aia/config";
import { createObjectStorage } from "@aia/storage";

config({ path: "../../.env", quiet: true });
let instance: ReturnType<typeof createObjectStorage> | undefined;

export function storageConfiguration() { return inspectStorageEnv(process.env); }
export function storageEnvironment() {
  const configuration = storageConfiguration();
  if (configuration.status !== "READY") throw new Error("INVALID_STORAGE_ENVIRONMENT");
  return configuration.environment;
}
export function objectStorage() {
  const environment = storageEnvironment();
  instance ??= createObjectStorage({
    endpoint: environment.MINIO_ENDPOINT,
    accessKey: environment.MINIO_ACCESS_KEY,
    secretKey: environment.MINIO_SECRET_KEY,
    bucket: environment.MINIO_PHOTOS_BUCKET,
    region: environment.MINIO_REGION,
  });
  return instance;
}
