import { expect, it } from "vitest";
import { createLogger } from "../../packages/config/src/logger.ts";
it("logs only permitted identifiers, never request content or arbitrary error objects", () => {
  const lines: string[] = [];
  const logger = createLogger({ write: value => { lines.push(value); } });
  logger.error("REQUEST_FAILED", { requestId: "00000000-0000-4000-8000-000000000001", documentNumber: "SECRET_ID", phone: "SECRET_PHONE", token: "SECRET_TOKEN", photo: "SECRET_PHOTO", error: new Error("SECRET_ERROR") });
  logger.error("REQUEST_FAILED", { requestId: "SECRET_IN_IDENTIFIER" });
  expect(lines.join("")).not.toContain("SECRET");
  expect(lines[0]).toContain("00000000-0000-4000-8000-000000000001");
});

