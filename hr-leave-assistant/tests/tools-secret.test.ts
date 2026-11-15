import { describe, expect, it, vi } from "vitest";
import { handleVerifyEmployee } from "../src/tools";
import type { AppEnv, EmployeeLeaveStub, HrDeskStub, SqlDatabaseBinding } from "../src/env";

const HASH_KEY = "test-hash-key-for-tools-secret";

function createMockDb(options: {
  firstResult?: unknown;
  throwOnPrepare?: boolean;
} = {}): SqlDatabaseBinding {
  const stmt = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => options.firstResult ?? null) as unknown as <T>() => Promise<T | null>,
    all: vi.fn(async () => ({ results: [] })) as unknown as <T>() => Promise<{ results: T[] }>,
    run: vi.fn(async () => ({ results: [] })) as unknown as <T>() => Promise<{ results: T[] }>,
  };
  return {
    prepare: vi.fn(() => {
      if (options.throwOnPrepare) {
        throw new Error("sql down");
      }
      return stmt as unknown as ReturnType<SqlDatabaseBinding["prepare"]>;
    }),
    batch: vi.fn(async () => []),
  };
}

async function createMockEnv(options: {
  employee?: Partial<EmployeeLeaveStub>;
  hrDesk?: Partial<HrDeskStub>;
  db?: SqlDatabaseBinding;
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
    TERADB: options.db,
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
          ensureProfile: async () => "ok" as const,
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

const employeeRow1001 = {
  employee_number: "1001",
  first_name: "Alex",
  entitlement_days: 14,
  opening_used_days: 6,
  pin_hash: "deadbeef00000000000000000000000000000000000000000000000000000000",
  secret_question: "What is your favourite colour?",
  secret_answer_hash: "cafebabe00000000000000000000000000000000000000000000000000000000",
  active: 1,
};

const employeeRow9999 = {
  employee_number: "9999",
  first_name: "Test",
  entitlement_days: 14,
  opening_used_days: 0,
  pin_hash: "abcd123400000000000000000000000000000000000000000000000000000000",
  secret_question: null,
  secret_answer_hash: null,
  active: 1,
};

describe("handleVerifyEmployee", () => {
  it("returns auth_token when PIN is correct and no secret question", async () => {
    const db = createMockDb({ firstResult: employeeRow9999 });
    const env = await createMockEnv({
      db,
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
    expect(observation.roster).toBe("hit");
  });

  it("returns auth_token when PIN is correct even if employee has a secret question", async () => {
    const db = createMockDb({ firstResult: employeeRow1001 });
    const env = await createMockEnv({ db });
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
    expect(observation.roster).toBe("hit");
  });

  it("returns auth_failed on wrong PIN", async () => {
    const db = createMockDb({ firstResult: employeeRow1001 });
    const env = await createMockEnv({
      db,
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
    const db = createMockDb({ firstResult: employeeRow1001 });
    const env = await createMockEnv({
      db,
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
    const db = createMockDb({ firstResult: null });
    const env = await createMockEnv({
      db,
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
    expect(observation.roster).toBe("missing");
  });

  it("returns unavailable when SQL is down", async () => {
    const db = createMockDb({ throwOnPrepare: true });
    const env = await createMockEnv({ db });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(observation.roster).toBe("error");
  });

  it("returns unavailable when the actor ensureProfile throws unexpectedly", async () => {
    const db = createMockDb({ firstResult: employeeRow1001 });
    const env = await createMockEnv({
      db,
      employee: {
        ensureProfile: async () => {
          throw new Error("actor down");
        },
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unavailable",
    });
  });

  it("calls ensureProfile with roster identity fields", async () => {
    const db = createMockDb({ firstResult: employeeRow1001 });
    const ensureProfile = vi.fn(async () => "ok" as const);
    const env = await createMockEnv({
      db,
      employee: { ensureProfile },
    });
    const observation: Record<string, unknown> = {};
    await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "1111",
    });

    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(ensureProfile).toHaveBeenCalledWith({
      firstName: "Alex",
      entitlementDays: 14,
      openingUsedDays: 6,
      pinHash: employeeRow1001.pin_hash,
      secretQuestion: "What is your favourite colour?",
      secretAnswerHash: "cafebabe00000000000000000000000000000000000000000000000000000000",
    });
  });

  it("returns missing for an inactive employee", async () => {
    const db = createMockDb({
      firstResult: {
        employee_number: "1001",
        first_name: "Alex",
        entitlement_days: 14,
        opening_used_days: 6,
        pin_hash: "deadbeef00000000000000000000000000000000000000000000000000000000",
        secret_question: null,
        secret_answer_hash: null,
        active: 0,
      },
    });
    const env = await createMockEnv({
      db,
      hrDesk: {
        failUnknown: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "auth_failed",
    });
    expect(observation.roster).toBe("missing");
  });

  it("returns error when the SQL deadline is exceeded", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.first = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return null;
    }) as unknown as typeof stmt.first;

    const env = await createMockEnv({ db });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(observation.roster).toBe("error");
  });

  it("does not leak PIN, hash, or employee number in error message", async () => {
    const db = createMockDb({ firstResult: employeeRow1001 });
    const env = await createMockEnv({
      db,
      employee: {
        verifyPin: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, undefined, {
      employee_number: "1001",
      pin: "9999",
    });

    const text = JSON.stringify(result);
    expect(text).not.toContain("9999");
    expect(text).not.toContain("deadbeef");
    expect(text).not.toContain("1001");
  });
});
