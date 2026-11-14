import { describe, expect, it, vi } from "vitest";
import {
  loadCompanyProfile,
  loadLeaveChangesFlag,
  loadCompanyContext,
} from "../src/lib/kv";
import { DEFAULT_PROFILE } from "../src/config/default-profile";
import type { AppEnv } from "../src/env";

function createMockEnv(kvGet: (key: string) => Promise<unknown>): AppEnv {
  return {
    SECRETS: { get: async () => undefined },
    HR_KV: { get: kvGet as AppEnv["HR_KV"]["get"], put: async () => {}, delete: async () => {} },
    EMPLOYEE_LEAVE: {
      idFromName: () =>
        ({
          verifyPin: async () => ({ status: "ok" as const, firstName: "Alex" }),
          verifySecretAnswer: async () => ({ status: "ok" as const, firstName: "Alex" }),
          setSecretQuestion: async () => "ok" as const,
          summary: async () => ({
            firstName: "Alex",
            entitlementDays: 14,
            usedDays: 6,
            remainingDays: 8,
            upcoming: [],
          }),
          check: async () => ({ ok: true as const, remainingAfter: 7 }),
          apply: async () => ({
            status: "approved" as const,
            reference: "LV-TEST01",
            remainingAfter: 7,
            replayed: false,
          }),
          cancel: async () => ({
            status: "cancelled" as const,
            reference: "LV-TEST01",
            days: 1,
            remainingAfter: 9,
            replayed: false,
          }),
          requests: async () => [],
          stats: async () => ({
            verified: 0,
            authFailures: 0,
            lockouts: 0,
            approved: 0,
            replays: 0,
            insufficient: 0,
            overlaps: 0,
            cancelled: 0,
            cancelReplays: 0,
          }),
          reset: async () => "ok" as const,
          ping: async () => "ok" as const,
        } as ReturnType<AppEnv["EMPLOYEE_LEAVE"]["idFromName"]>),
    },
    HR_DESK: {
      idFromName: () =>
        ({
          addCallback: async () => ({ reference: "CB-TEST01", replayed: false }),
          failUnknown: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
          listCallbacks: async () => [],
          stats: async () => ({
            callbacksQueued: 0,
            callbackReplays: 0,
            unknownEmployeeAttempts: 0,
            unknownLockouts: 0,
          }),
          reset: async () => "ok" as const,
          ping: async () => "ok" as const,
        } as ReturnType<AppEnv["HR_DESK"]["idFromName"]>),
    },
    CALLER_PROFILE: {
      idFromName: () =>
        ({
          recordCall: async () => ({ callCount: 1, returning: false }),
          ping: async () => "ok" as const,
        } as ReturnType<AppEnv["CALLER_PROFILE"]["idFromName"]>),
    },

  } as AppEnv;
}

describe("loadCompanyProfile", () => {
  it("returns hit when a valid profile is stored in KV", async () => {
    const env = createMockEnv(async () => DEFAULT_PROFILE);
    const result = await loadCompanyProfile(env);
    expect(result.kv).toBe("hit");
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });

  it("returns missing and the default profile when the key is absent", async () => {
    const env = createMockEnv(async () => null);
    const result = await loadCompanyProfile(env);
    expect(result.kv).toBe("missing");
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });

  it("returns missing and the default profile when the stored value is invalid", async () => {
    const env = createMockEnv(async () => ({ unexpected: true }));
    const result = await loadCompanyProfile(env);
    expect(result.kv).toBe("missing");
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });

  it("returns error and the default profile when KV throws", async () => {
    const env = createMockEnv(async () => {
      throw new Error("KV outage");
    });
    const result = await loadCompanyProfile(env);
    expect(result.kv).toBe("error");
    expect(result.profile).toEqual(DEFAULT_PROFILE);
  });
});

describe("loadLeaveChangesFlag", () => {
  it("returns hit when the flag is true", async () => {
    const env = createMockEnv(async () => "true");
    const result = await loadLeaveChangesFlag(env);
    expect(result.kv).toBe("hit");
    expect(result.enabled).toBe(true);
  });

  it("returns hit when the flag is false", async () => {
    const env = createMockEnv(async () => "false");
    const result = await loadLeaveChangesFlag(env);
    expect(result.kv).toBe("hit");
    expect(result.enabled).toBe(false);
  });

  it("returns missing and enabled true when the key is absent", async () => {
    const env = createMockEnv(async () => null);
    const result = await loadLeaveChangesFlag(env);
    expect(result.kv).toBe("missing");
    expect(result.enabled).toBe(true);
  });

  it("returns missing and enabled true when the value is invalid", async () => {
    const env = createMockEnv(async () => "maybe");
    const result = await loadLeaveChangesFlag(env);
    expect(result.kv).toBe("missing");
    expect(result.enabled).toBe(true);
  });

  it("returns error and enabled true when KV throws", async () => {
    const env = createMockEnv(async () => {
      throw new Error("KV outage");
    });
    const result = await loadLeaveChangesFlag(env);
    expect(result.kv).toBe("error");
    expect(result.enabled).toBe(true);
  });
});

describe("loadCompanyContext", () => {
  it("returns hit when both profile and flag are hits", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") return DEFAULT_PROFILE;
      if (key === "flags/leave_changes_enabled") return "true";
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("hit");
    expect(result.profile).toEqual(DEFAULT_PROFILE);
    expect(result.leaveChangesEnabled).toBe(true);
  });

  it("returns missing when the profile is missing", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") return null;
      if (key === "flags/leave_changes_enabled") return "true";
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("missing");
  });

  it("returns missing when the flag is missing", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") return DEFAULT_PROFILE;
      if (key === "flags/leave_changes_enabled") return null;
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("missing");
  });

  it("returns error when the profile errors", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") throw new Error("KV outage");
      if (key === "flags/leave_changes_enabled") return "true";
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("error");
  });

  it("returns error when the flag errors", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") return DEFAULT_PROFILE;
      if (key === "flags/leave_changes_enabled") throw new Error("KV outage");
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("error");
  });

  it("returns error when one is missing and the other errors", async () => {
    const env = createMockEnv(async (key: string) => {
      if (key === "profile/current") return null;
      if (key === "flags/leave_changes_enabled") throw new Error("KV outage");
      return null;
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("error");
  });

  it("returns missing when both are missing", async () => {
    const env = createMockEnv(async () => null);
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("missing");
  });

  it("returns error when both error", async () => {
    const env = createMockEnv(async () => {
      throw new Error("KV outage");
    });
    const result = await loadCompanyContext(env);
    expect(result.kv).toBe("error");
  });
});
