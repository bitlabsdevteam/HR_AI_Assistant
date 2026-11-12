import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/config/default-profile";
import {
  closedRangesOverlap,
  validateLeaveDates,
  workingDaysInclusive,
} from "../src/domain/leave";

describe("working-day counting", () => {
  it("counts both endpoints and skips a weekend", () => {
    expect(workingDaysInclusive("2026-11-13", "2026-11-16", [])).toBe(2);
  });

  it("skips company holidays", () => {
    expect(workingDaysInclusive("2026-11-25", "2026-11-27", DEFAULT_PROFILE.holidays)).toBe(2);
    expect(workingDaysInclusive("2026-11-26", "2026-11-26", DEFAULT_PROFILE.holidays)).toBe(0);
  });
});

describe("leave policy validation", () => {
  const base = {
    startDate: "2026-11-16",
    endDate: "2026-11-17",
    todayIso: "2026-11-12",
    profile: DEFAULT_PROFILE,
  };

  it("accepts valid dates", () => {
    expect(validateLeaveDates(base)).toEqual({ ok: true, workingDays: 2 });
  });

  it("rejects non-real and reversed dates as invalid input", () => {
    expect(validateLeaveDates({ ...base, startDate: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(validateLeaveDates({ ...base, endDate: "2026-11-15" })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("enforces minimum notice", () => {
    expect(validateLeaveDates({ ...base, startDate: "2026-11-12" })).toMatchObject({
      ok: false,
      code: "out_of_policy",
    });
  });

  it("enforces the leave year", () => {
    expect(validateLeaveDates({ ...base, startDate: "2027-07-01", endDate: "2027-07-02" })).toMatchObject({
      ok: false,
      code: "out_of_policy",
    });
  });

  it("requires a working day", () => {
    expect(validateLeaveDates({ ...base, startDate: "2026-11-14", endDate: "2026-11-15" })).toMatchObject({
      ok: false,
      code: "out_of_policy",
    });
  });

  it("limits a request to ten working days", () => {
    expect(validateLeaveDates({ ...base, startDate: "2026-11-16", endDate: "2026-12-01" })).toMatchObject({
      ok: false,
      code: "out_of_policy",
    });
  });
});

describe("closed-range overlap", () => {
  it("counts a shared endpoint as overlap", () => {
    expect(closedRangesOverlap("2026-11-16", "2026-11-18", "2026-11-18", "2026-11-20")).toBe(
      true,
    );
  });

  it("allows adjacent but non-intersecting leave", () => {
    expect(closedRangesOverlap("2026-11-16", "2026-11-18", "2026-11-19", "2026-11-20")).toBe(
      false,
    );
  });
});
