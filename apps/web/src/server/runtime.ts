import { config } from "dotenv";
import { parseEnv } from "@aia/config";
import { createDatabase } from "@aia/database";
let db: ReturnType<typeof createDatabase> | undefined;
export function database() {
  if (!db) {
    config({ path: "../../.env", quiet: true });
    db = createDatabase(parseEnv(process.env).DATABASE_URL);
  }
  return db;
}

