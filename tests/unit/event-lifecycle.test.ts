import { describe, expect, it } from "vitest";
import { effectiveEventStatus, publishedEventStatus } from "../../packages/domain/src/index.ts";

const schedule = {
  startDate: new Date("2030-06-01T00:00:00.000Z"),
  endDate: new Date("2030-06-03T00:00:00.000Z"),
  onboardingOpensAt: new Date("2030-05-01T08:00:00.000Z"),
  onboardingClosesAt: new Date("2030-05-31T17:00:00.000Z"),
  timezone: "Europe/Lisbon",
};

describe("event lifecycle", () => {
  it("derives published phases from the schedule", () => {
    expect(publishedEventStatus(schedule, new Date("2030-04-30T12:00:00.000Z"))).toBe("ONBOARDING_CLOSED");
    expect(publishedEventStatus(schedule, new Date("2030-05-15T12:00:00.000Z"))).toBe("ONBOARDING_OPEN");
    expect(publishedEventStatus(schedule, new Date("2030-05-31T18:00:00.000Z"))).toBe("ONBOARDING_CLOSED");
    expect(publishedEventStatus(schedule, new Date("2030-06-02T12:00:00.000Z"))).toBe("ACTIVE");
    expect(publishedEventStatus(schedule, new Date("2030-06-04T12:00:00.000Z"))).toBe("COMPLETED");
  });

  it("keeps draft and archived events outside automatic publication", () => {
    expect(effectiveEventStatus({ ...schedule, status: "DRAFT" }, new Date("2030-05-15T12:00:00.000Z"))).toBe("DRAFT");
    expect(effectiveEventStatus({ ...schedule, status: "ARCHIVED" }, new Date("2030-05-15T12:00:00.000Z"))).toBe("ARCHIVED");
  });
});
