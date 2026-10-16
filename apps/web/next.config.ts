import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { config as loadEnv } from "dotenv";
import path from "node:path";
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
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  allowedDevOrigins,
  distDir: process.env.NEXT_DIST_DIR || undefined,
  poweredByHeader: false,
  async headers(){return [{source:"/:path*",headers:[{key:"X-Content-Type-Options",value:"nosniff"},{key:"Referrer-Policy",value:"no-referrer"},{key:"X-Frame-Options",value:"DENY"},{key:"Content-Security-Policy",value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"},{key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},...(process.env.DEPLOYMENT_ENV==="production"?[{key:"Strict-Transport-Security",value:"max-age=31536000"}]:[])]}];},
  transpilePackages: ["@aia/config", "@aia/database", "@aia/domain", "@aia/i18n"],
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  logging: { incomingRequests: false },
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
