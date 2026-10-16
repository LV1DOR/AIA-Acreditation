import { spawn } from "node:child_process";
import { config } from "dotenv";
import { setTimeout as pause } from "node:timers/promises";
config({ path: ".env", quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL_REQUIRED");
const target = new URL(testUrl);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "16432" || target.pathname !== "/aia_acreditacao_test") throw new Error("ISOLATED_TEST_DATABASE_REQUIRED");
if (!process.env.REDIS_URL || !["127.0.0.1", "localhost"].includes(new URL(process.env.REDIS_URL).hostname) || new URL(process.env.REDIS_URL).port !== "16379") throw new Error("ISOLATED_LOCAL_REDIS_REQUIRED");
const url = "http://127.0.0.1:3299/api/health/ready";
const occupied = await fetch(url, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
if (occupied) throw new Error("SMOKE_PORT_ALREADY_IN_USE");
const child = spawn(process.execPath, [(process.env.WORKER_DIST_DIR??"dist")+"/main.js"], {
  cwd: new URL("../apps/worker/", import.meta.url), windowsHide: true, stdio: "ignore",
  env: { ...process.env, DATABASE_URL: testUrl, WORKER_HEALTH_PORT: "3299", MINIO_PHOTOS_BUCKET: "aia-phase1-synthetic",
    // Exercise imports/startup/readiness only; do not contact Clerk or dispatch emails.
    CLERK_SECRET_KEY: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_WEBHOOK_SIGNING_SECRET: "", AUTH_EMAIL_ENCRYPTION_KEY: "" },
});
const stopped = new Promise<void>(resolve => child.once("exit", () => resolve()));
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("WORKER_STARTUP_FAILED");
    ready = await fetch(url, { signal: AbortSignal.timeout(500) }).then(response => response.status === 200, () => false);
    if (ready) break;
    await pause(100);
  }
  if (!ready) throw new Error("WORKER_READINESS_FAILED");
  console.log("PASS: built worker imports and readiness on guarded test DB/Redis, synthetic bucket; email disabled");
} finally {
  if(child.connected)child.send("shutdown");else child.kill();
  await Promise.race([stopped, pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
