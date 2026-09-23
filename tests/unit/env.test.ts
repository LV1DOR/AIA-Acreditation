import { expect, it } from "vitest";
import { parseEnv } from "../../packages/config/src/env.ts";
const base = { DATABASE_URL: "postgresql://test:test@127.0.0.1:16432/test", SMTP_HOST: "127.0.0.1", SMTP_PORT: "11025", SMTP_FROM: "test@example.invalid" };
it("selects SMTP now, not Postmark", () => { expect(parseEnv(base).EMAIL_PROVIDER).toBe("smtp"); expect(() => parseEnv({ ...base, EMAIL_PROVIDER: "postmark" })).toThrow("INVALID_ENVIRONMENT"); });
it("does not coerce false into true", () => { expect(parseEnv({ ...base, SMTP_SECURE: "false" }).SMTP_SECURE).toBe(false); });
it("validates paired SMTP credentials without exposing them", () => {
  expect(() => parseEnv({ ...base, SMTP_PASSWORD: "SECRET" })).toThrow(/^INVALID_ENVIRONMENT$/);
});
it("rejects a non-PostgreSQL database", () => { expect(() => parseEnv({ ...base, DATABASE_URL: "https://example.invalid" })).toThrow(); });

