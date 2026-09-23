import { expect, it } from "vitest";
import { inspectStorageEnv, parseStorageEnv } from "../../packages/config/src/index.ts";

const valid = {
  MINIO_ENDPOINT: "http://127.0.0.1:19000",
  MINIO_ACCESS_KEY: "local-access",
  MINIO_SECRET_KEY: "local-secret",
  MINIO_PHOTOS_BUCKET: "aia-acreditacao-photos",
  MINIO_REGION: "us-east-1",
  DOCUMENT_ENCRYPTION_KEY: "11".repeat(32),
  DOCUMENT_FINGERPRINT_KEY: "22".repeat(32),
};

it("fails closed for absent, incomplete, or reused storage protection keys", () => {
  expect(inspectStorageEnv({}).status).toBe("MISSING");
  expect(inspectStorageEnv({ MINIO_ENDPOINT: valid.MINIO_ENDPOINT }).status).toBe("INVALID");
  expect(() => parseStorageEnv({ ...valid, DOCUMENT_FINGERPRINT_KEY: valid.DOCUMENT_ENCRYPTION_KEY })).toThrow("INVALID_STORAGE_ENVIRONMENT");
  expect(inspectStorageEnv(valid).status).toBe("READY");
});
