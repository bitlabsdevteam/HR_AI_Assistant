import { describe, expect, it, vi } from "vitest";
import { handleVerifyEmployee } from "../src/tools";
import type { AppEnv, EmployeeLeaveStub, HrDeskStub } from "../src/env";

const HASH_KEY = "test-hash-key-for-tools-secret";

vi.mock("../src/config/default-employees", () => ({
  DEFAULT_EMPLOYEES: [
    {
      employeeNumber: "1001",
      firstName: "Alex",
      entitlementDays: 14,
      openingUsedDays: 6,
      pin: "1111",
      secretQuestion: "What is your favourite colour?",
      secretAnswer: "Blue",
    },
    {
      employeeNumber: "9999",
      firstName: "Test",
      entitlementDays: 14,
      openingUsedDays: 0,
      pin: "0000",
      secretQuestion: null,
      secretAnswer: null,
    },
  ],
}));

async function createMockEnv(options: {
  employee?: Partial<EmployeeLeaveStub>;
  hrDesk?: Partial<HrDeskStub>;
} = {}): Promise<AppEnv> {
  return {
    SECRETS: {
      get: async (name: string) => {
        if (name === "HASH_KEY") return HASH_KEY;
        return undefined;
      },
    },
    HR_KV: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    },
    EMPLOYEE_LEAVE: {
      idFromName: () =>
        ({
          verifyPin: async () => ({ status: "ok" as const, firstName: "Alex" }),
          verifySecretAnswer: async () => ({ status: "ok" as const, firstName: "Alex" }),
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
          setSecretQuestion: async () => "ok" as const,
          ...options.employee,
        }) satisfies EmployeeLeaveStub,
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
          ...options.hrDesk,
        }) satisfies HrDeskStub,
    },
    CALLER_PROFILE: {
      idFromName: () => ({
        recordCall: async () => ({ callCount: 1, returning: false }),
        ping: async () => "ok" as const,
      }),
    },

  } as AppEnv;
}

describe("handleVerifyEmployee", () => {
  it("returns auth_token when PIN is correct and no secret question", async () => {
    const env = await createMockEnv({
      employee: {
        verifyPin: async () => ({ status: "ok" as const, firstName: "Test" }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "9999",
      pin: "0000",
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        auth_token: expect.stringMatching(/^v1\.9999\.\d+\.[0-9a-f]{32}$/),
        first_name: "Test",
      },
    });
    expect(observation.actor_event).toBe("pin_verified");
  });

  it("returns auth_token when PIN is correct even if employee has a secret question", async () => {
    // Secret-question step is removed from the MCP flow; verify_employee issues the token directly.
    const env = await createMockEnv();
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, "conv_abc", {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        auth_token: expect.stringMatching(/^v1\.1001\.\d+\.[0-9a-f]{32}$/),
        first_name: "Alex",
      },
    });
    expect(observation.actor_event).toBe("pin_verified");
  });

  it("returns auth_failed on wrong PIN", async () => {
    const env = await createMockEnv({
      employee: {
        verifyPin: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "9999",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "auth_failed",
    });
    expect(observation.actor_event).toBe("pin_failed");
  });

  it("returns locked when account is locked", async () => {
    const env = await createMockEnv({
      employee: {
        verifyPin: async () => ({ status: "locked" as const, minutesLeft: 15 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "9999",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "locked",
    });
    expect(observation.actor_event).toBe("pin_locked");
  });

  it("records actor_event for unknown employee failure", async () => {
    const env = await createMockEnv({
      hrDesk: {
        failUnknown: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "0000",
      pin: "1234",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "auth_failed",
    });
    expect(observation.actor_event).toBe("unknown_failed");
  });
});
