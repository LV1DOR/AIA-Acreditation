import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";

export function createDatabase(url: string) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("INVALID_DATABASE_URL");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 2000, query_timeout: 5000, max: 10 }),
    // Never enable query/parameter or raw database error logging.
    log: [],
  });
}
