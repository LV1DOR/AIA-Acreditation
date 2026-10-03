import { describe, expect, it } from "vitest";
import { normalizePhoneNumber } from "../../packages/domain/src/participants/phone.ts";

describe("participant phone numbers", () => {
  it("accepts possible numbers regardless of spacing or allocated prefix", () => {
    expect(normalizePhoneNumber("+351 111 111 111")).toBe("+351111111111");
    expect(normalizePhoneNumber("+44 (1111) 111111")).toBe("+441111111111");
  });

  it("enforces the national number length for the selected country", () => {
    expect(() => normalizePhoneNumber("+351 111 111 11")).toThrow("INVALID_INPUT");
    expect(() => normalizePhoneNumber("+351 111 111 1111")).toThrow("INVALID_INPUT");
  });
});
