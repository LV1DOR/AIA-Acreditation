import { expect, it } from "vitest";
import { validateLocalDevelopment } from "../../scripts/lib/local-dev.ts";

const local = {
  DEPLOYMENT_ENV: "local", AIA_SYNTHETIC_DATA: "true",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:16432/aia_acreditacao_local",
  TEST_DATABASE_URL: "postgresql://local:local@127.0.0.1:16432/aia_acreditacao_test",
  REDIS_URL: "redis://127.0.0.1:16379", SMTP_HOST: "127.0.0.1", SMTP_PORT: "11025", SMTP_FROM: "test@example.invalid",
  APP_ORIGIN: "http://localhost:3100", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic", CLERK_SECRET_KEY: "sk_test_synthetic",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_synthetic", AUTH_EMAIL_ENCRYPTION_KEY: "11".repeat(32),
  MINIO_ENDPOINT: "http://127.0.0.1:19000", MINIO_ACCESS_KEY: "local-access", MINIO_SECRET_KEY: "local-secret", MINIO_PHOTOS_BUCKET: "aia-acreditacao-photos",
  DOCUMENT_ENCRYPTION_KEY: "22".repeat(32), DOCUMENT_FINGERPRINT_KEY: "33".repeat(32),
};

it("accepts isolated local development with Mailpit and test Clerk keys", () => {
  expect(() => validateLocalDevelopment(local)).not.toThrow();
});

it.each([
  { DEPLOYMENT_ENV: "production" }, { AIA_SYNTHETIC_DATA: "false" },
  { DATABASE_URL: local.DATABASE_URL.replace("127.0.0.1", "db.example.com") },
  { TEST_DATABASE_URL: local.DATABASE_URL },
  { REDIS_URL: "redis://cache.example.com:16379" }, { MINIO_ENDPOINT: "https://storage.example.com:19000" },
  { SMTP_HOST: "smtp.example.com" }, { SMTP_PORT: "587" },
  { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_synthetic", CLERK_SECRET_KEY: "sk_live_synthetic" },
  { AUTH_ADDITIONAL_ORIGINS: "https://tunnel.example.com" },
  { APP_ORIGIN: "https://portal.example.com" }, { WORKER_HEALTH_HOST: "0.0.0.0" },
  { PRIVACY_DATABASE_URL: local.DATABASE_URL }, { MIGRATION_DATABASE_URL: local.DATABASE_URL },
  { MIGRATION_TARGET_FILE: "production.json" }, { AIA_PROXY_SECRET: "synthetic" },
])("rejects an unsafe development override: %j", override => {
  expect(() => validateLocalDevelopment({ ...local, ...override })).toThrow();
});
