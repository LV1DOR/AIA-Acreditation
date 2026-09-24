import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env", quiet: true });

const allowedDevOrigins: string[] = [];
try {
  if (process.env.APP_ORIGIN) {
    allowedDevOrigins.push(new URL(process.env.APP_ORIGIN).hostname);
  }
} catch {
  // Environment validation reports an invalid APP_ORIGIN with a clearer error.
}

const config: NextConfig = {
  allowedDevOrigins,
  distDir: process.env.NEXT_DIST_DIR || undefined,
  poweredByHeader: false,
  transpilePackages: ["@aia/config", "@aia/database", "@aia/domain", "@aia/i18n"],
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  logging: { incomingRequests: false },
  experimental: { serverActions: { bodySizeLimit: "151mb" } },
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
