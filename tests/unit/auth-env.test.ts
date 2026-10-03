import { expect, it } from "vitest";
import { inspectAuthEnv, parseAuthEnv } from "../../packages/config/src/auth-env.ts";
it("allows an explicitly disconnected local shell", () => { expect(parseAuthEnv({}).CLERK_SECRET_KEY).toBeUndefined(); });
it("treats empty optional values as deliberately unconfigured", () => {
  expect(inspectAuthEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "" }).status).toBe("MISSING");
});
it("classifies absent, partial and complete authentication configuration", () => {
  expect(inspectAuthEnv({}).status).toBe("MISSING");
  expect(inspectAuthEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic" }).status).toBe("INVALID");
  expect(inspectAuthEnv({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic",
    CLERK_SECRET_KEY: "sk_test_synthetic",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_synthetic",
    AUTH_EMAIL_ENCRYPTION_KEY: "a".repeat(64),
  }).status).toBe("READY");
});
it("rejects partial auth configuration and unsafe origins", () => {
  expect(() => parseAuthEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic" })).toThrow("INVALID_AUTH_ENVIRONMENT");
  expect(() => parseAuthEnv({ APP_ORIGIN: "http://example.com" })).toThrow();
  expect(() => parseAuthEnv({ APP_ORIGIN: "https://example.com/path" })).toThrow();
  expect(() => parseAuthEnv({ AUTH_ADDITIONAL_ORIGINS: "http://tunnel.example.com" })).toThrow();
  expect(() => parseAuthEnv({ AUTH_ADDITIONAL_ORIGINS: "https://tunnel.example.com/path" })).toThrow();
});
it("accepts a bounded list of additional HTTPS authentication origins", () => {
  expect(parseAuthEnv({
    APP_ORIGIN: "http://localhost:3100",
    AUTH_ADDITIONAL_ORIGINS: "https://first.example.com, https://second.example.com,https://first.example.com",
  }).AUTH_ADDITIONAL_ORIGINS).toEqual(["https://first.example.com", "https://second.example.com"]);
});
it("requires SMTP webhook bridge configuration before Clerk is enabled", () => {
  expect(() => parseAuthEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_synthetic", CLERK_SECRET_KEY: "sk_test_synthetic" })).toThrow();
});
