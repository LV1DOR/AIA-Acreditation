import { config } from "dotenv";
import { createDatabase } from "@aia/database";
import { createLogger, parseEnv, parseAuthEnv } from "@aia/config";
import { deliverNextAuthEmail, deliverNextBusinessEmail, enqueueDueDeadlineReminders, publishNextInvalidation } from "@aia/domain";
import { createSmtpTransport } from "@aia/email";
import { createClerkClient } from "@clerk/backend";
import Redis from "ioredis";
import { healthServer } from "./health.ts";
config({ path: "../../.env", quiet: true });
const logger = createLogger();
async function main() {
  const env = parseEnv(process.env);
  const authEnv = parseAuthEnv(process.env);
  const db = createDatabase(env.DATABASE_URL);
  await db.$queryRaw`SELECT 1`;
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  redis.on("error", () => logger.error("DEPENDENCY_UNAVAILABLE"));
  await redis.connect();
  const server = healthServer(db, () => redis.status === "ready");
  server.on("error", () => { logger.error("STARTUP_FAILED"); void db.$disconnect().finally(() => process.exit(1)); });
  server.listen(env.WORKER_HEALTH_PORT, "127.0.0.1", () => logger.info("WORKER_STARTED"));
  const transport = createSmtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, from: env.SMTP_FROM, user: env.SMTP_USER, password: env.SMTP_PASSWORD });
  const clerk = authEnv.CLERK_SECRET_KEY ? createClerkClient({ secretKey: authEnv.CLERK_SECRET_KEY }) : null;
  const resolveEmail = async (clerkUserId: string) => {
    if (!clerk) throw new Error("AUTH_NOT_CONFIGURED");
    const user = await clerk.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId && item.verification?.status === "verified");
    const verified = primary ?? user.emailAddresses.find(item => item.verification?.status === "verified");
    if (!verified) throw new Error("RECIPIENT_UNAVAILABLE");
    return verified.emailAddress;
  };
  let busy = false, reminderBusy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await publishNextInvalidation(db, message => redis.publish("aia:acreditacao:portal-invalidation", message));
      if (authEnv.AUTH_EMAIL_ENCRYPTION_KEY) await deliverNextAuthEmail(db, transport, authEnv.AUTH_EMAIL_ENCRYPTION_KEY);
      if (clerk) await deliverNextBusinessEmail(db, transport, authEnv.APP_ORIGIN, resolveEmail);
    }
    catch { logger.error("DEPENDENCY_UNAVAILABLE"); }
    finally { busy = false; }
  }, 1000);
  const reminders = setInterval(async () => {
    if (reminderBusy) return;
    reminderBusy = true;
    try { await enqueueDueDeadlineReminders(db); } catch { logger.error("DEPENDENCY_UNAVAILABLE"); } finally { reminderBusy = false; }
  }, 300000);
  void enqueueDueDeadlineReminders(db).catch(() => logger.error("DEPENDENCY_UNAVAILABLE"));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    clearInterval(timer); clearInterval(reminders);
    transport.close();
    redis.disconnect();
    server.close(() => { void db.$disconnect().finally(() => { logger.info("WORKER_STOPPED"); process.exit(0); }); });
  });
}
main().catch(() => { logger.error("STARTUP_FAILED"); process.exitCode = 1; });
