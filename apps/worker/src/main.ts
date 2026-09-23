import { config } from "dotenv";
import { createDatabase } from "@aia/database";
import { createLogger, parseEnv, parseAuthEnv } from "@aia/config";
import { deliverNextAuthEmail } from "@aia/domain";
import { createSmtpTransport } from "@aia/email";
import { healthServer } from "./health.ts";
config({ path: "../../.env", quiet: true });
const logger = createLogger();
async function main() {
  const env = parseEnv(process.env);
  const authEnv = parseAuthEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);
  await db.$queryRaw`SELECT 1`;
  const server = healthServer(db);
  server.on("error", () => { logger.error("STARTUP_FAILED"); void db.$disconnect().finally(() => process.exit(1)); });
  server.listen(env.WORKER_HEALTH_PORT, "127.0.0.1", () => logger.info("WORKER_STARTED"));
  const transport = createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.SMTP_FROM, user: env.SMTP_USER, password: env.SMTP_PASSWORD });
  let busy = false;
  // Only encrypted email handlers run here; business invalidation messages remain pending.
  const timer = setInterval(async () => {
    if (busy || !authEnv.AUTH_EMAIL_ENCRYPTION_KEY) return;
    busy = true;
    try { await deliverNextAuthEmail(db, transport, authEnv.AUTH_EMAIL_ENCRYPTION_KEY); }
    catch { logger.error("DEPENDENCY_UNAVAILABLE"); }
    finally { busy = false; }
  }, 1000);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    clearInterval(timer);
    transport.close();
    server.close(() => { void db.$disconnect().finally(() => { logger.info("WORKER_STOPPED"); process.exit(0); }); });
  });
}
main().catch(() => { logger.error("STARTUP_FAILED"); process.exitCode = 1; });
