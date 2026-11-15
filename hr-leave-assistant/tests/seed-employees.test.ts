import { describe, expect, it, vi } from "vitest";
import handler from "../src/index";
import type { AppEnv, SqlDatabaseBinding } from "../src/env";

const OPS_TOKEN = "test-ops-token";

function createMockDb(): SqlDatabaseBinding {
  const stmt = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => null),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ results: [] })),
  };
  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(async () => []),
  };
}

function createEnv(db?: SqlDatabaseBinding, secrets?: Record<string, string>): AppEnv {
  return {
    SECRETS: {
      get: vi.fn(async (name: string) => secrets?.[name] ?? undefined),
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

function makeRequest(method: string, token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request(`http://localhost/admin/seed-employees`, {
    method,
    headers,
  });
}

describe("POST /admin/seed-employees", () => {
  it("returns 401 without token", async () => {
    const env = createEnv(createMockDb(), { OPS_TOKEN });
    const req = makeRequest("POST");
    const res = await handler.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 405 on GET", async () => {
    const env = createEnv(createMockDb(), { OPS_TOKEN });
    const req = makeRequest("GET", OPS_TOKEN);
    const res = await handler.fetch(req, env);
    expect(res.status).toBe(405);
  });

  it("returns seeded count on success", async () => {
    const db = createMockDb();
    const env = createEnv(db, { OPS_TOKEN, HASH_KEY: "test-key" });
    const req = makeRequest("POST", OPS_TOKEN);

    const res = await handler.fetch(req, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; count: number };
    expect(body.status).toBe("seeded");
    expect(body.count).toBe(4); // DEFAULT_EMPLOYEES has 4 entries
  });

  it("is idempotent (second run does not duplicate)", async () => {
    const db = createMockDb();
    const env = createEnv(db, { OPS_TOKEN, HASH_KEY: "test-key" });

    // First call
    const req1 = makeRequest("POST", OPS_TOKEN);
    const res1 = await handler.fetch(req1, env);
    expect(res1.status).toBe(200);

    // Second call
    const req2 = makeRequest("POST", OPS_TOKEN);
    const res2 = await handler.fetch(req2, env);
    expect(res2.status).toBe(200);

    const body2 = (await res2.json()) as { status: string; count: number };
    expect(body2.count).toBe(4);
    expect(db.batch).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when SQL fails", async () => {
    const db = createMockDb();
    db.batch = vi.fn(async () => {
      throw new Error("sql failure");
    });

    const env = createEnv(db, { OPS_TOKEN, HASH_KEY: "test-key" });
    const req = makeRequest("POST", OPS_TOKEN);
    const res = await handler.fetch(req, env);
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unavailable");
  });

  it("returns 500 when HASH_KEY is missing", async () => {
    const db = createMockDb();
    const env = createEnv(db, { OPS_TOKEN });
    const req = makeRequest("POST", OPS_TOKEN);
    const res = await handler.fetch(req, env);
    expect(res.status).toBe(500);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unavailable");
  });

  it("does not include PIN, hash, or employee number in the response body", async () => {
    const db = createMockDb();
    const env = createEnv(db, { OPS_TOKEN, HASH_KEY: "test-key" });
    const req = makeRequest("POST", OPS_TOKEN);

    const res = await handler.fetch(req, env);
    const text = await res.text();

    expect(text).not.toContain("1111");
    expect(text).not.toContain("2222");
    expect(text).not.toContain("1001");
    expect(text).not.toContain("deadbeef");
  });
});
