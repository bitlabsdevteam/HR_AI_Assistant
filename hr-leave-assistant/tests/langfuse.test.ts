import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeTraceId,
  exportSpan,
  isAllowlisted,
  loadLangfuseCredentials,
} from "../src/lib/langfuse";

/* ------------------------------------------------------------------ */
/*  computeTraceId – known vector                                     */
/* ------------------------------------------------------------------ */

describe("computeTraceId", () => {
  it("returns the first 32 hex characters of SHA-256", async () => {
    const conversationId = "telnyx-conv-abc123";
    const traceId = await computeTraceId(conversationId);

    // Verify length and hex-only characters.
    expect(traceId).toHaveLength(32);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    // Verify determinism: same input → same output.
    const second = await computeTraceId(conversationId);
    expect(second).toBe(traceId);

    // Different input → different output.
    const other = await computeTraceId("different-conv");
    expect(other).not.toBe(traceId);
  });

  it("matches a manually verified SHA-256 digest for a fixed string", async () => {
    // Known vector: SHA-256("hello") starts with 2cf24dba…
    // First 32 hex chars: "2cf24dba5fb0a30e26e83b2ac5b9e29e"
    const traceId = await computeTraceId("hello");
    expect(traceId).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e");
  });
});

/* ------------------------------------------------------------------ */
/*  Allowlist enforcement                                             */
/* ------------------------------------------------------------------ */

describe("isAllowlisted", () => {
  it("returns true for every TDD-allowlisted key", () => {
    const allowed = [
      "call_ref",
      "conversation_id",
      "tool",
      "node",
      "outcome",
      "duration_ms",
      "actor_ms",
      "emp",
      "caller",
      "revision",
    ];
    for (const key of allowed) {
      expect(isAllowlisted(key), `expected ${key} to be allowlisted`).toBe(true);
    }
  });

  it("returns false for forbidden keys (PIN, token, name, body)", () => {
    const forbidden = [
      "pin",
      "token",
      "auth_token",
      "employee_number",
      "name",
      "first_name",
      "body",
      "password",
      "secret",
    ];
    for (const key of forbidden) {
      expect(isAllowlisted(key), `expected ${key} to be forbidden`).toBe(false);
    }
  });
});

describe("exportSpan allowlist", () => {
  it("drops non-allowlisted metadata before building the OTLP payload", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200 } as Response),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const credentials = {
      publicKey: "pk-test",
      secretKey: "sk-test",
      host: "https://langfuse.example.com",
    };

    const result = await exportSpan(credentials, {
      spanName: "test.tool",
      startTime: 1_000_000,
      endTime: 1_000_100,
      outcome: "ok",
      metadata: {
        conversation_id: "conv-123",
        call_ref: "c_aaaaaaaaaaaa",
        outcome: "ok",
        duration_ms: 100,
        // Forbidden fields that must NOT appear in the payload
        pin: "1234",
        auth_token: "v1.1001.12345.abc",
        employee_number: "1001",
        first_name: "Alex",
        body: '{"secret": true}',
      },
    });

    expect(result).toBe("sent");
    expect(fetchSpy).toHaveBeenCalledOnce();

    const call = fetchSpy.mock.calls[0] as [string, { body: string }] | undefined;
    const init = call?.[1];
    const body = JSON.parse(init?.body ?? "{}");
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    const attrs = spans[0].attributes as Array<{ key: string; value: unknown }>;

    const keys = attrs.map((a) => a.key);

    // Allow-listed keys must be present.
    expect(keys).toContain("conversation_id");
    expect(keys).toContain("call_ref");
    expect(keys).toContain("outcome");
    expect(keys).toContain("duration_ms");

    // Langfuse observation attributes added by exportSpan must be present.
    expect(keys).toContain("langfuse.observation.level");
    expect(keys).toContain("langfuse.observation.type");

    // Verify langfuse.observation.type is 'tool'.
    const typeAttr = attrs.find((a) => a.key === "langfuse.observation.type");
    expect(typeAttr?.value).toEqual({ stringValue: "tool" });

    // Verify langfuse.observation.level matches the outcome.
    const levelAttr = attrs.find((a) => a.key === "langfuse.observation.level");
    expect(levelAttr?.value).toEqual({ stringValue: "DEFAULT" });

    // Forbidden keys must be absent.
    expect(keys).not.toContain("pin");
    expect(keys).not.toContain("auth_token");
    expect(keys).not.toContain("employee_number");
    expect(keys).not.toContain("first_name");
    expect(keys).not.toContain("body");

    vi.unstubAllGlobals();
  });
});

/* ------------------------------------------------------------------ */
/*  exportSpan resilience                                             */
/* ------------------------------------------------------------------ */

describe("exportSpan resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns "off" when credentials are undefined', async () => {
    const result = await exportSpan(undefined, {
      spanName: "test",
      startTime: 0,
      endTime: 1,
      outcome: "ok",
      metadata: { conversation_id: "conv-1" },
    });
    expect(result).toBe("off");
  });

  it('returns "skipped" when there is no conversation_id', async () => {
    const result = await exportSpan(
      { publicKey: "pk", secretKey: "sk", host: "https://example.com" },
      { spanName: "test", startTime: 0, endTime: 1, outcome: "ok" },
    );
    expect(result).toBe("skipped");
  });

  it('returns "failed" when fetch rejects', async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

    const result = await exportSpan(
      { publicKey: "pk", secretKey: "sk", host: "https://example.com" },
      {
        spanName: "test",
        startTime: 0,
        endTime: 1,
        outcome: "ok",
        metadata: { conversation_id: "conv-1" },
      },
    );
    expect(result).toBe("failed");
  });

  it('returns "failed" when fetch hangs beyond the 300 ms cap', async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const signal = init.signal;
          if (signal) {
            signal.addEventListener("abort", () =>
              reject(new Error("AbortError")),
            );
          }
        }),
    );

    const promise = exportSpan(
      { publicKey: "pk", secretKey: "sk", host: "https://example.com" },
      {
        spanName: "test",
        startTime: 0,
        endTime: 1,
        outcome: "ok",
        metadata: { conversation_id: "conv-1" },
      },
    );

    // Advance past the 300 ms abort window.
    vi.advanceTimersByTime(400);

    const result = await promise;
    expect(result).toBe("failed");
  });

  it("maps outcomes to the correct Langfuse observation level", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200 } as Response),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const credentials = {
      publicKey: "pk-test",
      secretKey: "sk-test",
      host: "https://langfuse.example.com",
    };

    const cases: Array<{ outcome: import("../src/lib/log").LogOutcome; expected: string }> = [
      { outcome: "ok", expected: "DEFAULT" },
      { outcome: "verified", expected: "DEFAULT" },
      { outcome: "approved", expected: "DEFAULT" },
      { outcome: "cancelled", expected: "DEFAULT" },
      { outcome: "queued", expected: "DEFAULT" },
      { outcome: "auth_failed", expected: "WARNING" },
      { outcome: "locked", expected: "WARNING" },
      { outcome: "insufficient_balance", expected: "WARNING" },
      { outcome: "overlap", expected: "WARNING" },
      { outcome: "unauthenticated", expected: "WARNING" },
      { outcome: "unauthorized", expected: "WARNING" },
      { outcome: "method_not_allowed", expected: "WARNING" },
      { outcome: "error", expected: "ERROR" },
    ];

    for (const { outcome, expected } of cases) {
      fetchSpy.mockClear();
      await exportSpan(credentials, {
        spanName: "test",
        startTime: 0,
        endTime: 1,
        outcome,
        metadata: { conversation_id: "conv-1" },
      });

      const call = fetchSpy.mock.calls[0] as [string, { body: string }] | undefined;
      const body = JSON.parse(call?.[1].body ?? "{}");
      const spans = body.resourceSpans[0].scopeSpans[0].spans;
      const attrs = spans[0].attributes as Array<{ key: string; value: unknown }>;
      const levelAttr = attrs.find((a) => a.key === "langfuse.observation.level");
      expect(levelAttr?.value, `expected level ${expected} for outcome ${outcome}`).toEqual({
        stringValue: expected,
      });
    }

    vi.unstubAllGlobals();
  });

  it("never throws even when everything goes wrong", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("synchronous throw");
    });

    await expect(
      exportSpan(
        { publicKey: "pk", secretKey: "sk", host: "https://example.com" },
        {
          spanName: "test",
          startTime: 0,
          endTime: 1,
          outcome: "ok",
          metadata: { conversation_id: "conv-1" },
        },
      ),
    ).resolves.toBe("failed");
  });
});

/* ------------------------------------------------------------------ */
/*  loadLangfuseCredentials                                           */
/* ------------------------------------------------------------------ */

describe("loadLangfuseCredentials", () => {
  it("returns undefined when any secret is missing", async () => {
    const env = {
      SECRETS: {
        get: vi.fn((name: string) =>
          Promise.resolve(
            name === "LANGFUSE_PUBLIC_KEY" ? "pk" : undefined,
          ),
        ),
      },
    };

    const creds = await loadLangfuseCredentials(env);
    expect(creds).toBeUndefined();
  });

  it("returns credentials when all three secrets are present", async () => {
    const env = {
      SECRETS: {
        get: vi.fn((name: string) => {
          const map: Record<string, string> = {
            LANGFUSE_PUBLIC_KEY: "pk-abc",
            LANGFUSE_SECRET_KEY: "sk-xyz",
            LANGFUSE_HOST: "https://langfuse.example.com",
          };
          return Promise.resolve(map[name]!);
        }),
      },
    };

    const creds = await loadLangfuseCredentials(env);
    expect(creds).toEqual({
      publicKey: "pk-abc",
      secretKey: "sk-xyz",
      host: "https://langfuse.example.com",
    });
  });
});
