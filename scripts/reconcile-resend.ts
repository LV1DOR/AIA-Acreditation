import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { createDatabase } from "../packages/database/src/index.ts";
import { resendMetadataReader } from "../packages/email/src/resend.ts";
import { reconcileRecentResendMessages } from "../packages/domain/src/notifications/email-reconciliation.ts";
import { deploymentMode } from "../packages/config/src/deployment-env.ts";
import { validateDatabaseTarget, type Target } from "./lib/targets.ts";

config({ path: ".env", quiet: true });
// Explicit target and window, matching the repository's operator-tool boundary.
// Credentials are injected server-side. Never accept API keys in CLI arguments.
const [targetFile, sinceArgument, pageArgument = "5"] = process.argv.slice(2);
if (!targetFile || !sinceArgument) throw new Error("USAGE_reconcile-resend_TARGET_JSON_SINCE_ISO_MAX_PAGES");
const target: Target = JSON.parse(await readFile(targetFile, "utf8"));
if (target.environment !== deploymentMode()) throw new Error("RECONCILIATION_ENVIRONMENT_MISMATCH");
const url = process.env.DATABASE_URL, key = process.env.RESEND_MONITOR_API_KEY;
if (!url || !key) throw new Error("RECONCILIATION_CONFIGURATION_REQUIRED");
validateDatabaseTarget(url, target);
const db = createDatabase(url);
try {
  const result = await reconcileRecentResendMessages(db, resendMetadataReader(key), new Date(sinceArgument), Number(pageArgument));
  console.log(JSON.stringify({ code: "RESEND_RECONCILIATION_COMPLETE", ...result }));
} catch { console.error("RESEND_RECONCILIATION_FAILED"); process.exitCode = 1; }
finally { await db.$disconnect(); }
