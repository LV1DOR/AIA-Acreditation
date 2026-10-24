import { parseAuthEnv, parseEnv, parseStorageEnv } from "../../packages/config/src/index.ts";
import { validateDatabaseTarget } from "./targets.ts";

// This guard is deliberately stricter than general runtime configuration. A
// local dev worker must never send real email or use production infrastructure.
export function validateLocalDevelopment(input: Record<string, string | undefined>) {
  if (input.DEPLOYMENT_ENV !== "local" || input.AIA_SYNTHETIC_DATA !== "true") throw Error("EXPLICIT_LOCAL_SYNTHETIC_MODE_REQUIRED");
  const env = parseEnv(input), auth = parseAuthEnv(input), storage = parseStorageEnv(input);
  validateDatabaseTarget(env.DATABASE_URL, { environment: "local", host: "127.0.0.1", port: 16432, database: "aia_acreditacao_local" });
  validateDatabaseTarget(input.TEST_DATABASE_URL ?? "", { environment: "test", host: "127.0.0.1", port: 16432, database: "aia_acreditacao_test" });
  const localUrl = (value: string, protocol: string, port: string) => {
    const url = new URL(value);
    return ["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol === protocol && url.port === port;
  };
  if (!localUrl(env.REDIS_URL, "redis:", "16379") || !localUrl(storage.MINIO_ENDPOINT, "http:", "19000")) throw Error("LOCAL_DEPENDENCIES_REQUIRED");
  if (!["localhost", "127.0.0.1"].includes(env.SMTP_HOST) || env.SMTP_PORT !== 11025 || env.SMTP_USER || env.SMTP_PASSWORD || env.SMTP_SECURE || env.SMTP_REQUIRE_TLS) throw Error("LOCAL_MAILPIT_REQUIRED");
  if (!localUrl(auth.APP_ORIGIN, "http:", "3100") || auth.AUTH_ADDITIONAL_ORIGINS.length || env.WORKER_HEALTH_HOST !== "127.0.0.1" || env.WORKER_HEALTH_PORT !== 3102) throw Error("LOOPBACK_DEVELOPMENT_REQUIRED");
  if (!auth.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") || !auth.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw Error("CLERK_DEVELOPMENT_KEYS_REQUIRED");
  if (input.PRIVACY_DATABASE_URL || input.MIGRATION_DATABASE_URL || input.MIGRATION_TARGET_FILE || input.AIA_PROXY_SECRET || (storage.CLAMAV_HOST && !["localhost", "127.0.0.1"].includes(storage.CLAMAV_HOST))) throw Error("EXTERNAL_OR_PRIVILEGED_OVERRIDE_FORBIDDEN");
}
