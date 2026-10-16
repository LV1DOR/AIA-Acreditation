import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
// Test-runner domain fixtures and web servers share explicit synthetic intent.
process.env.DEPLOYMENT_ENV="test";process.env.AIA_SYNTHETIC_DATA="true";

const clerkKeys = [
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  process.env.CLERK_SECRET_KEY,
  process.env.CLERK_WEBHOOK_SIGNING_SECRET,
  process.env.AUTH_EMAIL_ENCRYPTION_KEY,
];
function isolatedTestDatabase(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost"].includes(url.hostname) && url.port==="16432" && url.pathname === "/aia_acreditacao_test";
  } catch { return false; }
}
const liveClerkConfigured = clerkKeys.every(Boolean) &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") === true &&
  process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true &&
  isolatedTestDatabase(process.env.TEST_DATABASE_URL);

if (process.env.PLAYWRIGHT_REQUIRE_LIVE_CLERK === "1" && !liveClerkConfigured) {
  throw new Error("LIVE_CLERK_E2E_CONFIGURATION_REQUIRED");
}

if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY ??= process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

const unconfiguredEnvironment = {
  ...process.env,
  DEBUG: "",DEPLOYMENT_ENV:"test",AIA_SYNTHETIC_DATA:"true",
  NEXT_DIST_DIR: ".next-playwright-unconfigured",
  APP_ORIGIN: "http://localhost:3201",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  CLERK_SECRET_KEY: "",
  CLERK_WEBHOOK_SIGNING_SECRET: "",
  AUTH_EMAIL_ENCRYPTION_KEY: "",
};

const liveEnvironment = {
  ...process.env,
  DEBUG: "",
  NEXT_DIST_DIR: ".next-playwright-clerk",
  APP_ORIGIN: "http://localhost:3200",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: "unconfigured",
      testMatch: /missing-config\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3201" },
    },
    ...(liveClerkConfigured ? [
      { name: "clerk-setup", testMatch: /clerk\.setup\.ts/ },
      {
        name: "clerk-live",
        testMatch: /clerk-live\.spec\.ts/,
        dependencies: ["clerk-setup"],
        use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3200" },
      },
    ] : []),
  ],
  webServer: [
    {
      command: "corepack pnpm --filter @aia/web exec next dev --hostname localhost --port 3201",
      url: "http://localhost:3201/api/health/live",
      env: unconfiguredEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(liveClerkConfigured ? [{
      command: "corepack pnpm --filter @aia/web exec next dev --hostname localhost --port 3200",
      url: "http://localhost:3200/api/health/live",
      env: liveEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
    }] : []),
  ],
});
