import { z } from "zod";
import { assertProductionConfiguration } from "./deployment-env.ts";

const schema = z.object({
  MINIO_ENDPOINT: z.url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_PHOTOS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  MINIO_REGION: z.string().min(1).default("us-east-1"),
  CLAMAV_HOST: z.string().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().max(65535).default(3310),
  DOCUMENT_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  DOCUMENT_FINGERPRINT_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().refine(value => value.DOCUMENT_ENCRYPTION_KEY !== value.DOCUMENT_FINGERPRINT_KEY);

export type StorageEnvironment = z.infer<typeof schema>;
export type StorageEnvironmentState =
  | { status: "MISSING" }
  | { status: "INVALID" }
  | { status: "READY"; environment: StorageEnvironment };

export function parseStorageEnv(input: Record<string, string | undefined>) {
  assertProductionConfiguration(input);
  const parsed = schema.safeParse({
    MINIO_ENDPOINT: input.MINIO_ENDPOINT,
    MINIO_ACCESS_KEY: input.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: input.MINIO_SECRET_KEY,
    MINIO_PHOTOS_BUCKET: input.MINIO_PHOTOS_BUCKET,
    MINIO_REGION: input.MINIO_REGION,
    CLAMAV_HOST: input.CLAMAV_HOST || undefined,
    CLAMAV_PORT: input.CLAMAV_PORT,
    DOCUMENT_ENCRYPTION_KEY: input.DOCUMENT_ENCRYPTION_KEY,
    DOCUMENT_FINGERPRINT_KEY: input.DOCUMENT_FINGERPRINT_KEY,
  });
  if (!parsed.success) throw new Error("INVALID_STORAGE_ENVIRONMENT");
  return parsed.data;
}

export function inspectStorageEnv(input: Record<string, string | undefined>): StorageEnvironmentState {
  const names = ["MINIO_ENDPOINT", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "MINIO_PHOTOS_BUCKET", "DOCUMENT_ENCRYPTION_KEY", "DOCUMENT_FINGERPRINT_KEY"] as const;
  if (names.every(name => !input[name])) return { status: "MISSING" };
  try { return { status: "READY", environment: parseStorageEnv(input) }; }
  catch { return { status: "INVALID" }; }
}
