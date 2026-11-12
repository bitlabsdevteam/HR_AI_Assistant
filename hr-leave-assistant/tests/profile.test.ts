import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "../src/config/default-profile";
import { parseCompanyProfile, policyAnswer } from "../src/domain/profile";

describe("company profile validation", () => {
  it("accepts the bundled profile from a JSON string", () => {
    expect(parseCompanyProfile(JSON.stringify(DEFAULT_PROFILE))).toEqual(DEFAULT_PROFILE);
  });

  it("rejects unknown keys against expected policy data", () => {
    expect(parseCompanyProfile({ ...DEFAULT_PROFILE, unexpected: true })).toBeNull();
  });

  it("rejects malformed calendar dates and time zones", () => {
    expect(parseCompanyProfile({ ...DEFAULT_PROFILE, holidays: ["2026-02-30"] })).toBeNull();
    expect(parseCompanyProfile({ ...DEFAULT_PROFILE, timezone: "Not/A_Timezone" })).toBeNull();
  });

  it("returns only approved policy text", () => {
    expect(policyAnswer(DEFAULT_PROFILE, "hours")).toContain("Monday through Friday");
  });
});
