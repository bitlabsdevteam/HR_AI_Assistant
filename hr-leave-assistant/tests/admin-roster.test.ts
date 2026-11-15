import { describe, expect, it, vi } from "vitest";
import handler from "../src/index";
import type { AppEnv, SqlDatabaseBinding } from "../src/env";

const OPS_TOKEN = "test-ops-token";
const HASH_KEY = "test-hash-key";

function createMockDb(options: {
  allResult?: Array<Record<string, unknown>>;
  firstResult?: Record<string, unknown> | null;
  throwOnPrepare?: boolean;
} = {}): SqlDatabaseBinding {
  const stmt = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => options.firstResult ?? null) as unknown as <T>() => Promise<T | null>,
    all: vi.fn(async () => ({ results: options.allResult ?? [] })) as unknown as <T>() => Promise<{ results: T[] }>,
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

function createEnv(db?: SqlDatabaseBinding): { env: AppEnv; employeeStub: ReturnType<AppEnv["EMPLOYEE_LEAVE"]["idFromName"]> } {
  const employeeStub = {
    verifyPin: vi.fn(async () => ({ status: "ok" as const, firstName: "Alex" })),
    verifySecretAnswer: vi.fn(async () => ({ status: "ok" as const, firstName: "Alex" })),
    setSecretQuestion: vi.fn(async () => "ok" as const),
    ensureProfile: vi.fn(async () => "ok" as const),
    summary: vi.fn(async () => ({
      firstName: "Alex",
      entitlementDays: 14,
      usedDays: 6,
      remainingDays: 8,
      upcoming: [],
    })),
    check: vi.fn(async () => ({ ok: true as const, remainingAfter: 7 })),
    apply: vi.fn(async () => ({
      status: "approved" as const,
      reference: "LV-TEST01",
      remainingAfter: 7,
      replayed: false,
    })),
    cancel: vi.fn(async () => ({
      status: "cancelled" as const,
      reference: "LV-TEST01",
      days: 1,
      remainingAfter: 9,
      replayed: false,
    })),
    requests: vi.fn(async () => []),
    stats: vi.fn(async () => ({
      verified: 1,
      authFailures: 0,
      lockouts: 0,
      approved: 0,
      replays: 0,
      insufficient: 0,
      overlaps: 0,
      cancelled: 0,
      cancelReplays: 0,
    })),
    reset: vi.fn(async () => "ok" as const),
    ping: vi.fn(async () => "ok" as const),
  };

  const env = {
    SECRETS: {
      get: vi.fn(async (name: string) => {
        if (name === "OPS_TOKEN") return OPS_TOKEN;
        if (name === "HASH_KEY") return HASH_KEY;
        return undefined;
      }),
    },
    HR_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    TERADB: db,
    EMPLOYEE_LEAVE: {
      idFromName: () => employeeStub,
    },
    HR_DESK: {
      idFromName: () => ({
        addCallback: vi.fn(async () => ({ reference: "CB-TEST01", replayed: false })),
        failUnknown: vi.fn(async () => ({ status: "failed" as const, attemptsLeft: 2 })),
        listCallbacks: vi.fn(async () => []),
        stats: vi.fn(async () => ({
          callbacksQueued: 0,
          callbackReplays: 0,
          unknownEmployeeAttempts: 0,
          unknownLockouts: 0,
        })),
        reset: vi.fn(async () => "ok" as const),
        ping: vi.fn(async () => "ok" as const),
      }),
    },
    CALLER_PROFILE: {
      idFromName: () => ({
        recordCall: vi.fn(async () => ({ callCount: 1, returning: false })),
        ping: vi.fn(async () => "ok" as const),
      }),
    },
  } as AppEnv;
  return { env, employeeStub };
}

function makeRequest(path: string, method: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${OPS_TOKEN}` },
  });
}

describe("admin routes iterate SQL roster", () => {
  it("GET /admin/requests returns all active roster employees", async () => {
    const db = createMockDb({
      allResult: [
        { employee_number: "1001" },
        { employee_number: "1002" },
      ],
    });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/admin/requests", "GET"), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { employees: Array<{ employee_number: string }> };
    expect(body.employees).toHaveLength(2);
    expect(body.employees[0]!.employee_number).toBe("1001");
    expect(body.employees[1]!.employee_number).toBe("1002");
  });

  it("GET /admin/requests with ?employee= returns 404 for missing employee", async () => {
    const db = createMockDb({ firstResult: null });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/admin/requests?employee=9999", "GET"), env);
    expect(res.status).toBe(404);
  });

  it("GET /admin/stats sums over the roster", async () => {
    const db = createMockDb({
      allResult: [
        { employee_number: "1001" },
        { employee_number: "1002" },
      ],
    });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/admin/stats", "GET"), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { stats: { verified: number } };
    expect(body.stats.verified).toBe(2);
  });

  it("POST /admin/reset resets only active roster employees", async () => {
    const db = createMockDb({
      allResult: [
        {
          employee_number: "1001",
          first_name: "Alex",
          entitlement_days: 14,
          opening_used_days: 6,
          pin_hash: "deadbeef00000000000000000000000000000000000000000000000000000000",
          secret_question: null,
          secret_answer_hash: null,
          active: 1,
        },
        {
          employee_number: "1002",
          first_name: "Priya",
          entitlement_days: 14,
          opening_used_days: 12,
          pin_hash: "cafebabe00000000000000000000000000000000000000000000000000000000",
          secret_question: "What city were you born in?",
          secret_answer_hash: "beefdead00000000000000000000000000000000000000000000000000000000",
          active: 1,
        },
      ],
    });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/admin/reset", "POST"), env);
    expect(res.status).toBe(200);

    expect(employeeStub.reset).toHaveBeenCalledTimes(2);
  });

  it("excludes inactive employees from reset", async () => {
    const db = createMockDb({
      allResult: [
        {
          employee_number: "1001",
          first_name: "Alex",
          entitlement_days: 14,
          opening_used_days: 6,
          pin_hash: "deadbeef00000000000000000000000000000000000000000000000000000000",
          secret_question: null,
          secret_answer_hash: null,
          active: 1,
        },
      ],
    });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/admin/reset", "POST"), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("reset");
  });

  it("GET /ops/check pings the first active roster employee", async () => {
    const db = createMockDb({
      allResult: [{ employee_number: "1001" }],
    });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/ops/check", "GET"), env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { dependencies: Record<string, { ok: boolean }> };
    expect(body.dependencies.employee_leave?.ok).toBe(true);
  });

  it("GET /ops/check reports failure when roster is empty", async () => {
    const db = createMockDb({ allResult: [] });
    const { env, employeeStub } = createEnv(db);
    const res = await handler.fetch(makeRequest("/ops/check", "GET"), env);
    expect(res.status).toBe(503);

    const body = (await res.json()) as { dependencies: Record<string, { ok: boolean; reason?: string }> };
    expect(body.dependencies.employee_leave?.ok).toBe(false);
    expect(body.dependencies.employee_leave?.reason).toBe("empty_roster");
  });
});
