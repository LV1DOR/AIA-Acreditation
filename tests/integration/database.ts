import { config } from "dotenv";
import { createDatabase } from "../../packages/database/src/index.ts";
config({ path: ".env", quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL_REQUIRED");
const target = new URL(url);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/aia_acreditacao_test") {
  throw new Error("INTEGRATION_TESTS_REQUIRE_ISOLATED_LOCAL_DATABASE");
}
export const db = createDatabase(url);

