import { describe, expect, it, vi } from "vitest";
import { findEmployee, listActiveEmployeeNumbers } from "../src/lib/roster";
import type { AppEnv, SqlDatabaseBinding } from "../src/env";

function createMockDb(overrides?: Partial<SqlDatabaseBinding>): SqlDatabaseBinding {
  const stmt = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => null),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ results: [] })),
  };
  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(async () => []),
    ...overrides,
  };
}

function createEnv(db?: SqlDatabaseBinding): AppEnv {
  return {
    SECRETS: {
      get: vi.fn(async () => undefined),
    },
    HR_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    TERADB: db,
    EMPLOYEE_LEAVE: {
      idFromName: () => ({
        verifyPin: vi.fn(),
        verifySecretAnswer: vi.fn(),
        setSecretQuestion: vi.fn(),
        summary: vi.fn(),
        check: vi.fn(),
        apply: vi.fn(),
        cancel: vi.fn(),
        requests: vi.fn(),
        stats: vi.fn(),
        reset: vi.fn(),
        ping: vi.fn(),
        ensureProfile: vi.fn(),
      }),
    },
    HR_DESK: {
      idFromName: () => ({
        addCallback: vi.fn(),
        failUnknown: vi.fn(),
        listCallbacks: vi.fn(),
        stats: vi.fn(),
        reset: vi.fn(),
        ping: vi.fn(),
      }),
    },
    CALLER_PROFILE: {
      idFromName: () => ({
        recordCall: vi.fn(),
        ping: vi.fn(),
      }),
    },
  } as AppEnv;
}

describe("findEmployee", () => {
  it("returns hit for an active employee", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.first = vi.fn(async () => ({
      employee_number: "1001",
      first_name: "Alex",
      entitlement_days: 14,
      pin_hash: "deadbeef",
      secret_question: "What is your favourite colour?",
      secret_answer_hash: "cafebabe",
      active: 1,
    })) as unknown as typeof stmt.first;

    const env = createEnv(db);
    const result = await findEmployee(env, "1001");

    expect(result.state).toBe("hit");
    if (result.state === "hit") {
      expect(result.employee.employeeNumber).toBe("1001");
      expect(result.employee.firstName).toBe("Alex");
      expect(result.employee.entitlementDays).toBe(14);
      expect(result.employee.pinHash).toBe("deadbeef");
      expect(result.employee.secretQuestion).toBe("What is your favourite colour?");
      expect(result.employee.secretAnswerHash).toBe("cafebabe");
    }
  });

  it("returns missing when no row is found", async () => {
    const db = createMockDb();
    const env = createEnv(db);
    const result = await findEmployee(env, "9999");
    expect(result.state).toBe("missing");
  });

  it("returns missing for an inactive employee", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.first = vi.fn(async () => ({
      employee_number: "1001",
      first_name: "Alex",
      entitlement_days: 14,
      pin_hash: "deadbeef",
      secret_question: null,
      secret_answer_hash: null,
      active: 0,
    })) as unknown as typeof stmt.first;

    const env = createEnv(db);
    const result = await findEmployee(env, "1001");
    expect(result.state).toBe("missing");
  });

  it("returns missing for a malformed row", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.first = vi.fn(async () => ({
      employee_number: "1001",
      // missing required fields
    })) as unknown as typeof stmt.first;

    const env = createEnv(db);
    const result = await findEmployee(env, "1001");
    expect(result.state).toBe("missing");
  });

  it("returns error when SQL throws", async () => {
    const db = createMockDb();
    db.prepare = vi.fn(() => {
      throw new Error("sql error");
    });

    const env = createEnv(db);
    const result = await findEmployee(env, "1001");
    expect(result.state).toBe("error");
  });

  it("returns error when the deadline is exceeded", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.first = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return null;
    });

    const env = createEnv(db);
    const result = await findEmployee(env, "1001");
    expect(result.state).toBe("error");
  });

  it("passes the employee number through bind and never includes it in the SQL text", async () => {
    const db = createMockDb();
    const env = createEnv(db);
    await findEmployee(env, "1001");

    expect(db.prepare).toHaveBeenCalledTimes(1);
    const sqlText = vi.mocked(db.prepare).mock.calls[0]![0];
    expect(sqlText).not.toContain("1001");
    expect(sqlText).toContain("?");

    const stmt = db.prepare("");
    expect(stmt.bind).toHaveBeenCalledTimes(1);
    expect(vi.mocked(stmt.bind).mock.calls[0]![0]).toBe("1001");
  });
});

describe("listActiveEmployeeNumbers", () => {
  it("returns ok with active employee numbers", async () => {
    const db = createMockDb();
    const stmt = db.prepare("");
    stmt.all = vi.fn(async () => ({
      results: [{ employee_number: "1001" }, { employee_number: "1002" }],
    })) as unknown as typeof stmt.all;

    const env = createEnv(db);
    const result = await listActiveEmployeeNumbers(env);

    expect(result.state).toBe("ok");
    if (result.state === "ok") {
      expect(result.numbers).toEqual(["1001", "1002"]);
    }
  });

  it("returns error when SQL throws", async () => {
    const db = createMockDb();
    db.prepare = vi.fn(() => {
      throw new Error("sql error");
    });

    const env = createEnv(db);
    const result = await listActiveEmployeeNumbers(env);
    expect(result.state).toBe("error");
  });

  it("returns error when no TERADB binding is present", async () => {
    const env = createEnv(undefined);
    const result = await listActiveEmployeeNumbers(env);
    expect(result.state).toBe("error");
  });
});
