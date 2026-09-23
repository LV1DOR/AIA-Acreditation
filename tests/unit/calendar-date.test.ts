import { describe, expect, it } from "vitest";
import { calendarDate, documentValidThroughEvent, fromDate, toDate } from "../../packages/domain/src/shared/calendar-date.ts";
describe("calendar dates", () => {
  it.each(["2026-03-29", "2026-10-25", "2028-02-29"])("round trips %s without timezone shifts", value => { expect(fromDate(toDate(value))).toBe(value); });
  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "21/09/2026"])("rejects invalid %s", value => { expect(calendarDate.safeParse(value).success).toBe(false); });
  it("validates through the whole event inclusively", () => {
    expect(documentValidThroughEvent("2026-09-20", "2026-09-21")).toBe(false);
    expect(documentValidThroughEvent("2026-09-21", "2026-09-21")).toBe(true);
  });
});

