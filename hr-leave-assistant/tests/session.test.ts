import { describe, expect, it, vi } from "vitest";
import {
  callerSessionKey,
  loadCallerSession,
  saveCallerSession,
  isRecentCaller,
} from "../src/lib/session";
import handler from "../src/index";
import type { AppEnv } from "../src/env";

vi.mock("../src/lib/signature", () => ({
  verifyTelnyxWebhookSignature: vi.fn(() => Promise.resolve(true)),
}));

function createMockEnv(options: {
  kvGet?: (key: string) => Promise<unknown>;
  kvPut?: () => Promise<void>;
} = {}): AppEnv {
  return {
    SECRETS: { get: async () => undefined },
    HR_KV: {
      get: (options.kvGet ?? (async () => null)) as AppEnv["HR_KV"]["get"],
      put: options.kvPut ?? (async () => {}),
      delete: async () => {},
    },
    EMPLOYEE_LEAVE: {
      idFromName: () =>
        ({
          verifyPin: async () => ({ status: "ok", firstName: "Alex" }),
          verifySecretAnswer: async () => ({ status: "ok", firstName: "Alex" }),
          setSecretQuestion: async () => "ok",
          summary: async () => ({
            firstName: "Alex",
            entitlementDays: 14,
            usedDays: 6,
            remainingDays: 8,
            upcoming: [],
          }),
          check: async () => ({ ok: true, remainingAfter: 7 }),
          apply: async () => ({
            status: "approved",
            reference: "LV-TEST01",
            remainingAfter: 7,
            replayed: false,
          }),
          cancel: async () => ({
            status: "cancelled",
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
          reset: async () => "ok",
          ping: async () => "ok",
        } as ReturnType<AppEnv["EMPLOYEE_LEAVE"]["idFromName"]>),
    },
    HR_DESK: {
      idFromName: () =>
        ({
          addCallback: async () => ({ reference: "CB-TEST01", replayed: false }),
          failUnknown: async () => ({ status: "failed", attemptsLeft: 2 }),
          listCallbacks: async () => [],
          stats: async () => ({
            callbacksQueued: 0,
            callbackReplays: 0,
            unknownEmployeeAttempts: 0,
            unknownLockouts: 0,
          }),
          reset: async () => "ok",
          ping: async () => "ok",
        } as ReturnType<AppEnv["HR_DESK"]["idFromName"]>),
    },
    CALLER_PROFILE: {
      idFromName: () =>
        ({
          recordCall: async () => ({ callCount: 1, returning: false }),
          ping: async () => "ok",
        } as ReturnType<AppEnv["CALLER_PROFILE"]["idFromName"]>),
    },
  } as AppEnv;
}

describe("callerSessionKey", () => {
  it("returns a key prefixed with session/caller/", async () => {
    const key = await callerSessionKey("test-hash-key", "+15551234567");
    expect(key.startsWith("session/caller/")).toBe(true);
  });

  it("contains no colons", async () => {
    const key = await callerSessionKey("test-hash-key", "+15551234567");
    expect(key).not.toContain(":");
  });

  it("is at most 256 characters", async () => {
    const key = await callerSessionKey("test-hash-key", "+15551234567");
    expect(key.length).toBeLessThanOrEqual(256);
  });
});

describe("loadCallerSession", () => {
  it("returns hit and recent true for a valid session within 30 minutes", async () => {
    const now = new Date();
    const stored = {
      v: 1,
      last_call_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      last_call_ref: "c_test123",
      last_call_id_hash: "abcd1234",
      last_outcome: "ready" as const,
    };
    const env = createMockEnv({
      kvGet: async () => stored,
    });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("hit");
    expect(result.recent).toBe(true);
  });

  it("returns hit and recent false for a valid session older than 30 minutes", async () => {
    const now = new Date();
    const stored = {
      v: 1,
      last_call_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      last_call_ref: "c_test123",
      last_call_id_hash: "abcd1234",
      last_outcome: "ready" as const,
    };
    const env = createMockEnv({
      kvGet: async () => stored,
    });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("hit");
    expect(result.recent).toBe(false);
  });

  it("returns missing when the key is absent", async () => {
    const env = createMockEnv({ kvGet: async () => null });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("missing");
  });

  it("returns error when KV get throws", async () => {
    const env = createMockEnv({
      kvGet: async () => {
        throw new Error("kv down");
      },
    });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("error");
  });

  it("returns missing when stored JSON is malformed", async () => {
    const env = createMockEnv({ kvGet: async () => ({ not: "valid" }) });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("missing");
  });

  it("returns missing when stored version is unknown", async () => {
    const env = createMockEnv({
      kvGet: async () => ({
        v: 2,
        last_call_at: new Date().toISOString(),
        last_call_ref: "c_test123",
        last_call_id_hash: "abcd1234",
        last_outcome: "ready",
      }),
    });
    const result = await loadCallerSession(env, "session/caller/test", "xyz7890");
    expect(result.state).toBe("missing");
  });

  it("returns missing when stored call_id_hash matches current (retry protection)", async () => {
    const stored = {
      v: 1,
      last_call_at: new Date().toISOString(),
      last_call_ref: "c_test123",
      last_call_id_hash: "samehash12345678",
      last_outcome: "ready" as const,
    };
    const env = createMockEnv({ kvGet: async () => stored });
    const result = await loadCallerSession(env, "session/caller/test", "samehash12345678");
    expect(result.state).toBe("missing");
  });
});

describe("saveCallerSession", () => {
  it("writes the record with TTL and returns true on success", async () => {
    const putMock = vi.fn(async () => {});
    const env = createMockEnv({ kvPut: putMock });
    const record = {
      v: 1 as const,
      last_call_at: new Date().toISOString(),
      last_call_ref: "c_test",
      last_call_id_hash: "hash1234",
      last_outcome: "ready" as const,
    };
    const result = await saveCallerSession(env, "session/caller/test", record);
    expect(result).toBe(true);
    expect(putMock).toHaveBeenCalledWith(
      "session/caller/test",
      JSON.stringify(record),
      { expirationTtl: 86400 },
    );
  });

  it("swallows KV put rejection and returns false", async () => {
    const putMock = vi.fn(async () => {
      throw new Error("kv down");
    });
    const env = createMockEnv({ kvPut: putMock });
    const record = {
      v: 1 as const,
      last_call_at: new Date().toISOString(),
      last_call_ref: "c_test",
      last_call_id_hash: "hash1234",
      last_outcome: "ready" as const,
    };
    const result = await saveCallerSession(env, "session/caller/test", record);
    expect(result).toBe(false);
  });

  it("times out after 300 ms and returns false", async () => {
    vi.useFakeTimers();
    const putMock = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const env = createMockEnv({ kvPut: putMock });
    const record = {
      v: 1 as const,
      last_call_at: new Date().toISOString(),
      last_call_ref: "c_test",
      last_call_id_hash: "hash1234",
      last_outcome: "ready" as const,
    };

    const savePromise = saveCallerSession(env, "session/caller/test", record);
    vi.advanceTimersByTime(300);
    const result = await savePromise;
    expect(result).toBe(false);
    vi.useRealTimers();
  });
});

describe("isRecentCaller", () => {
  it("returns true 1 second before the 30-minute boundary", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const lastCall = new Date("2026-01-01T11:30:01.000Z");
    expect(isRecentCaller(lastCall, now)).toBe(true);
  });

  it("returns false 1 second after the 30-minute boundary", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const lastCall = new Date("2026-01-01T11:29:59.000Z");
    expect(isRecentCaller(lastCall, now)).toBe(false);
  });

  it("returns true exactly at the 30-minute boundary", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const lastCall = new Date("2026-01-01T11:30:00.000Z");
    expect(isRecentCaller(lastCall, now)).toBe(true);
  });

  it("returns false for future dates", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const lastCall = new Date("2026-01-01T13:00:00.000Z");
    expect(isRecentCaller(lastCall, now)).toBe(false);
  });
});

describe("webhook integration", () => {
  function makeWebhookRequest(body: unknown): Request {
    return new Request("http://localhost/webhooks/dynamic-variables", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": "dummy",
        "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });
  }

  const validWebhookBody = {
    data: {
      id: "event_test",
      event_type: "assistant.initialization",
      payload: {
        telnyx_end_user_target: "+15551234567",
        call_control_id: "v3:test",
        telnyx_conversation_id: "conv_test123",
      },
    },
  };

  it("happy response has exactly nine dynamic variable keys, all strings", async () => {
    const env = createMockEnv();
    env.SECRETS.get = vi.fn(async (name: string) => {
      if (name === "HASH_KEY") return "test-hash-key";
      if (name === "TELNYX_PUBLIC_KEY") return "test-public-key";
      return undefined;
    });
    const req = makeWebhookRequest(validWebhookBody);
    const result = await handler.fetch(req, env);
    const body = (await result.json()) as Record<string, unknown>;
    const vars = body.dynamic_variables as Record<string, unknown>;

    expect(result.status).toBe(200);
    const keys = Object.keys(vars);
    expect(keys).toHaveLength(9);
    for (const key of keys) {
      expect(typeof vars[key]).toBe("string");
    }
  });

  it("returns recent_caller true and logs session hit when KV has a recent session", async () => {
    const now = new Date();
    const sessionRecord = {
      v: 1,
      last_call_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
      last_call_ref: "c_prev",
      last_call_id_hash: "prevhash12345678",
      last_outcome: "ready",
    };
    const env = createMockEnv({
      kvGet: async (key: string) => {
        if (key.startsWith("session/")) return sessionRecord;
        return null;
      },
    });
    env.SECRETS.get = vi.fn(async (name: string) => {
      if (name === "HASH_KEY") return "test-hash-key";
      if (name === "TELNYX_PUBLIC_KEY") return "test-public-key";
      return undefined;
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(String(args[0] ?? ""));
    };
    try {
      const req = makeWebhookRequest(validWebhookBody);
      const result = await handler.fetch(req, env);
      const body = (await result.json()) as Record<string, unknown>;
      const vars = body.dynamic_variables as Record<string, unknown>;

      expect(result.status).toBe(200);
      expect(vars).toHaveProperty("recent_caller", "true");

      const jsonLogs = logs
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((line): line is Record<string, unknown> => line !== null);
      expect(jsonLogs).toHaveLength(1);
      expect(jsonLogs[0]!.session).toBe("hit");
    } finally {
      console.log = originalLog;
    }
  });

  it("degraded response has leave_changes_enabled false and recent_caller false", async () => {
    const env = createMockEnv();
    env.SECRETS.get = vi.fn(async (name: string) => {
      if (name === "HASH_KEY") throw new Error("secret store unavailable");
      if (name === "TELNYX_PUBLIC_KEY") return "test-public-key";
      return undefined;
    });

    const req = makeWebhookRequest(validWebhookBody);
    const result = await handler.fetch(req, env);
    const body = (await result.json()) as Record<string, unknown>;
    const vars = body.dynamic_variables as Record<string, unknown>;

    expect(result.status).toBe(200);
    expect(vars.leave_changes_enabled).toBe("false");
    expect(vars.recent_caller).toBe("false");
    expect(vars.context_status).toBe("degraded");
    expect(vars.caller_status).toBe("unknown");
  });
});
