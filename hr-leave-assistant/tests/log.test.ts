import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import handler from "../src/index";
import type { AppEnv } from "../src/env";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/signature", () => ({
  verifyTelnyxWebhookSignature: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../src/config/default-employees", () => ({
  DEFAULT_EMPLOYEES: [
    {
      employeeNumber: "1001",
      firstName: "Alex",
      entitlementDays: 14,
      openingUsedDays: 6,
      pin: "1111",
      secretQuestion: null,
      secretAnswer: null,
    },
  ],
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HASH_KEY = "test-hash-key-for-log-tests";
const MCP_BEARER = "test-mcp-bearer";
const OPS_TOKEN = "test-ops-token";
const TELNYX_PUBLIC_KEY = "test-public-key";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEnv(options: {
  secrets?: Record<string, string | undefined>;
  throwSecret?: string;
} = {}): AppEnv {
  const secretMap: Record<string, string | undefined> = {
    HASH_KEY,
    MCP_BEARER,
    OPS_TOKEN,
    TELNYX_PUBLIC_KEY,
    ...options.secrets,
  };

  return {
    SECRETS: {
      get: vi.fn(async (name: string) => {
        if (options.throwSecret && name === options.throwSecret) {
          throw new Error("secret store unavailable");
        }
        return secretMap[name];
      }),
    },
    HR_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    EMPLOYEE_LEAVE: {
      idFromName: () => ({
        verifyPin: vi.fn(async () => ({ status: "ok" as const, firstName: "Alex" })),
        verifySecretAnswer: vi.fn(async () => ({ status: "ok" as const, firstName: "Alex" })),
        setSecretQuestion: vi.fn(async () => "ok" as const),
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
          verified: 0,
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
      }),
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
    HR_POLICY_BUCKET: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => null),
      head: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ objects: [], delimitedPrefixes: [], truncated: false })),
      createMultipartUpload: vi.fn(async () => ({
        key: "",
        uploadId: "",
        uploadPart: vi.fn(async () => ({ partNumber: 1, etag: "" })),
        complete: vi.fn(async () => ({ key: "", writeHttpMetadata: vi.fn(() => {}) })),
        abort: vi.fn(async () => {}),
      })),
      resumeMultipartUpload: vi.fn(() => ({
        key: "",
        uploadId: "",
        uploadPart: vi.fn(async () => ({ partNumber: 1, etag: "" })),
        complete: vi.fn(async () => ({ key: "", writeHttpMetadata: vi.fn(() => {}) })),
        abort: vi.fn(async () => {}),
      })),
    },
  } as AppEnv;
}

async function withLogCapture<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(String(args[0] ?? ""));
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = originalLog;
  }
}

function parseLogLines(logs: string[]): Array<Record<string, unknown>> {
  return logs
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== null);
}

function assertRequiredFields(line: Record<string, unknown>): void {
  expect(typeof line.ts).toBe("string");
  expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(typeof line.event).toBe("string");
  expect(typeof line.call_ref).toBe("string");
  expect(typeof line.outcome).toBe("string");
  expect(typeof line.status).toBe("number");
  expect(typeof line.duration_ms).toBe("number");
  expect(line.duration_ms).toBeGreaterThanOrEqual(0);
}

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

function makeMcpRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/mcp", {
    method,
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${MCP_BEARER}`,
      accept: "application/json, text/event-stream",
    },
  });
}

function makeOpsRequest(method: string): Request {
  return new Request("http://localhost/ops/check", {
    method,
    headers: { authorization: `Bearer ${OPS_TOKEN}` },
  });
}

function makeAdminRequest(path: string, method: string): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${OPS_TOKEN}` },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("completion log coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("webhook route", () => {
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

    it("writes exactly one JSON log line for a valid webhook request", async () => {
      const env = createMockEnv();
      const req = makeWebhookRequest(validWebhookBody);

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("webhook.completed");
      expect(jsonLogs[0]!.status).toBe(200);
      expect(jsonLogs[0]!.outcome).toBe("ready");
      expect(jsonLogs[0]!.trace).toBe("off");
      expect(typeof jsonLogs[0]!.call_ref).toBe("string");
      expect(jsonLogs[0]!.call_ref).toMatch(/^c_[0-9a-f]{12}$/);
    });

    it("writes exactly one JSON log line when the method is not POST", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/webhooks/dynamic-variables", {
        method: "GET",
        headers: {
          "telnyx-signature-ed25519": "dummy",
          "telnyx-timestamp": String(Math.floor(Date.now() / 1000)),
        },
      });

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(405);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("webhook.completed");
      expect(jsonLogs[0]!.outcome).toBe("invalid_input");
    });

    it("writes exactly one JSON log line when a secret throws after signature verification", async () => {
      const env = createMockEnv({ throwSecret: "HASH_KEY" });
      const req = makeWebhookRequest(validWebhookBody);

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      // Signature was already verified, so the handler degrades gracefully (200)
      // rather than returning 500.
      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("webhook.completed");
      expect(jsonLogs[0]!.outcome).toBe("degraded");
    });
  });

  describe("mcp route", () => {
    it("writes exactly one JSON log line for tools/list", async () => {
      const env = createMockEnv();
      const req = makeMcpRequest("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" });

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("tool.completed");
      expect(jsonLogs[0]!.outcome).toBe("ok");
      expect(jsonLogs[0]!.trace).toBe("off");
    });

    it("writes exactly one JSON log line when the bearer is missing", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
      });

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(401);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("tool.completed");
      expect(jsonLogs[0]!.outcome).toBe("unauthorized");
    });

    it("does not include a synthetic PIN in any emitted log line", async () => {
      const env = createMockEnv();
      const req = makeMcpRequest("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "verify_employee",
          arguments: { employee_number: "1001", pin: "1111" },
          _meta: { telnyx_conversation_id: "conv_test" },
        },
      });

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      const allText = logs.join(" ");
      expect(allText).not.toContain("1111");
    });

    it("does not include a synthetic session token in any emitted log line", async () => {
      const env = createMockEnv();

      // Step 1: obtain a session token via verify_employee
      const verifyReq = makeMcpRequest("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "verify_employee",
          arguments: { employee_number: "1001", pin: "1111" },
          _meta: { telnyx_conversation_id: "conv_test" },
        },
      });

      const { result: verifyRes, logs: verifyLogs } = await withLogCapture(() =>
        handler.fetch(verifyReq, env),
      );

      expect(verifyRes.status).toBe(200);
      const verifyBody = (await verifyRes.json()) as Record<string, unknown>;
      const verifyResult = verifyBody.result as Record<string, unknown> | undefined;
      const content = verifyResult?.content as Array<{ text: string }> | undefined;
      const textBlock = content?.[0]?.text ?? "";
      const parsedText = JSON.parse(textBlock) as { ok: boolean; data?: { auth_token?: string } };
      const token = parsedText.data?.auth_token;
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      // Step 2: use the token in get_leave_balance
      const balanceReq = makeMcpRequest("POST", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_leave_balance",
          arguments: { auth_token: token },
          _meta: { telnyx_conversation_id: "conv_test" },
        },
      });

      const { result: balanceRes, logs: balanceLogs } = await withLogCapture(() =>
        handler.fetch(balanceReq, env),
      );

      expect(balanceRes.status).toBe(200);

      // Combine all logs from both requests
      const allLogs = [...verifyLogs, ...balanceLogs];
      const allText = allLogs.join(" ");
      expect(allText).not.toContain(token);
    });
  });

  describe("ops route", () => {
    it("writes exactly one JSON log line for a valid ops check", async () => {
      const env = createMockEnv();
      const req = makeOpsRequest("GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("ops.completed");
      expect(jsonLogs[0]!.outcome).toBe("ok");
      expect(jsonLogs[0]!.call_ref).toBe("none");
      expect(jsonLogs[0]!.trace).toBe("off");
    });

    it("writes exactly one JSON log line when the method is not GET", async () => {
      const env = createMockEnv();
      const req = makeOpsRequest("POST");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(405);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("ops.completed");
      expect(jsonLogs[0]!.outcome).toBe("invalid_input");
    });
  });

  describe("admin routes", () => {
    it("GET /admin/requests writes exactly one JSON log line", async () => {
      const env = createMockEnv();
      const req = makeAdminRequest("/admin/requests", "GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
      expect(jsonLogs[0]!.outcome).toBe("ok");
    });

    it("GET /admin/requests without auth writes exactly one JSON log line", async () => {
      const env = createMockEnv();
      const req = new Request("http://localhost/admin/requests", { method: "GET" });

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(401);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
      expect(jsonLogs[0]!.outcome).toBe("unauthorized");
    });

    it("GET /admin/callbacks writes exactly one JSON log line", async () => {
      const env = createMockEnv();
      const req = makeAdminRequest("/admin/callbacks", "GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
    });

    it("GET /admin/stats writes exactly one JSON log line", async () => {
      const env = createMockEnv();
      const req = makeAdminRequest("/admin/stats", "GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
    });

    it("POST /admin/reset writes exactly one JSON log line", async () => {
      const env = createMockEnv();
      const req = makeAdminRequest("/admin/reset", "POST");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
    });

    it("writes exactly one JSON log line when a secret throws during an admin request", async () => {
      const env = createMockEnv({ throwSecret: "OPS_TOKEN" });
      const req = makeAdminRequest("/admin/requests", "GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(500);
      expect(jsonLogs).toHaveLength(1);
      assertRequiredFields(jsonLogs[0]!);
      expect(jsonLogs[0]!.event).toBe("admin.completed");
      expect(jsonLogs[0]!.outcome).toBe("error");
    });
  });

  describe("trace field", () => {
    it('is "off" when Langfuse secrets are missing', async () => {
      const env = createMockEnv();
      const req = makeOpsRequest("GET");

      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      expect(jsonLogs[0]!.trace).toBe("off");
    });

    it('is "failed" when the Langfuse POST fails', async () => {
      const env = createMockEnv({
        secrets: {
          LANGFUSE_PUBLIC_KEY: "pk-test",
          LANGFUSE_SECRET_KEY: "sk-test",
          LANGFUSE_HOST: "https://langfuse.example.com",
        },
      });
      vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

      // Use the MCP route because it supplies a conversation_id in the metadata,
      // which exportSpan needs in order to attempt a POST (and then fail).
      const req = makeMcpRequest("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: { telnyx_conversation_id: "conv_langfuse_fail" },
        },
      });
      const { result, logs } = await withLogCapture(() => handler.fetch(req, env));
      const jsonLogs = parseLogLines(logs);

      expect(result.status).toBe(200);
      expect(jsonLogs).toHaveLength(1);
      expect(jsonLogs[0]!.trace).toBe("failed");
    });
  });
});
