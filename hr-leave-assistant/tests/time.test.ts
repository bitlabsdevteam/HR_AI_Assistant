import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/config/default-profile";
import {
  addDays,
  isIsoCalendarDate,
  isOpenNow,
  spokenIsoDate,
  todayIsoInTimeZone,
} from "../src/domain/time";

describe("calendar time", () => {
  it("rejects non-real calendar dates", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2024-02-29")).toBe(true);
    expect(isIsoCalendarDate("12 November 2026")).toBe(false);
  });

  it("adds days using calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("gets today in the company time zone", () => {
    expect(todayIsoInTimeZone(new Date("2027-01-01T04:59:00Z"), "America/New_York")).toBe(
      "2026-12-31",
    );
    expect(todayIsoInTimeZone(new Date("2027-01-01T05:00:00Z"), "America/New_York")).toBe(
      "2027-01-01",
    );
  });

  it("speaks a date without a year", () => {
    expect(spokenIsoDate("2026-11-12")).toBe("Thursday, November 12");
  });
});

describe("HR desk hours", () => {
  it("includes opening time and excludes closing time", () => {
    expect(isOpenNow(new Date("2026-11-13T14:00:00Z"), DEFAULT_PROFILE)).toBe(true);
    expect(isOpenNow(new Date("2026-11-13T21:59:00Z"), DEFAULT_PROFILE)).toBe(true);
    expect(isOpenNow(new Date("2026-11-13T22:00:00Z"), DEFAULT_PROFILE)).toBe(false);
  });

  it("is closed on weekends", () => {
    expect(isOpenNow(new Date("2026-11-14T15:00:00Z"), DEFAULT_PROFILE)).toBe(false);
  });
});
