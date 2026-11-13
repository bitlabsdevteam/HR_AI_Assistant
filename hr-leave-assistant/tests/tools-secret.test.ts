import { describe, expect, it, vi } from "vitest";
import { handleVerifyEmployee, handleAnswerSecretQuestion } from "../src/tools";
import { createVerificationToken } from "../src/lib/verification-token";
import type { AppEnv, EmployeeLeaveStub, HrDeskStub } from "../src/env";
import type { CloudStorageBucket } from "@telnyx/edge-runtime";

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
    HR_POLICY_BUCKET: {
      get: async () => null,
      put: async () => null,
      head: async () => null,
      delete: async () => {},
      list: async () => ({ objects: [], delimitedPrefixes: [], truncated: false }),
      createMultipartUpload: async () => ({ key: "", uploadId: "", uploadPart: async () => ({ partNumber: 1, etag: "" }), complete: async () => ({ key: "", writeHttpMetadata: () => {} }), abort: async () => {} }),
      resumeMultipartUpload: () => ({ key: "", uploadId: "", uploadPart: async () => ({ partNumber: 1, etag: "" }), complete: async () => ({ key: "", writeHttpMetadata: () => {} }), abort: async () => {} }),
    } as CloudStorageBucket,
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
  });

  it("returns needs_secret_question when PIN is correct and employee has a secret question", async () => {
    // Default employees 1001-1004 all have secret questions in default-employees.ts
    const env = await createMockEnv();
    const observation: Record<string, unknown> = {};
    const result = await handleVerifyEmployee(env, observation, "conv_abc", {
      employee_number: "1001",
      pin: "1111",
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        needs_secret_question: true,
        question: "What is your favourite colour?",
        verification_token: expect.stringMatching(/^temp1\.1001\.conv_abc\.\d+\.[0-9a-f]{32}$/),
      },
    });
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
  });
});

describe("handleAnswerSecretQuestion", () => {
  it("returns auth_token on correct answer", async () => {
    const env = await createMockEnv();
    const observation: Record<string, unknown> = {};
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = await createVerificationToken({
      employeeNumber: "1001",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds,
    });

    const result = await handleAnswerSecretQuestion(env, observation, "conv_abc", {
      verification_token: token,
      answer: "Blue",
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        auth_token: expect.stringMatching(/^v1\.1001\.\d+\.[0-9a-f]{32}$/),
        first_name: "Alex",
      },
    });
  });

  it("returns auth_failed on wrong answer", async () => {
    const env = await createMockEnv({
      employee: {
        verifySecretAnswer: async () => ({ status: "failed" as const, attemptsLeft: 2 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = await createVerificationToken({
      employeeNumber: "1001",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds,
    });

    const result = await handleAnswerSecretQuestion(env, observation, "conv_abc", {
      verification_token: token,
      answer: "Red",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "auth_failed",
    });
  });

  it("returns locked after 3 failed attempts", async () => {
    const env = await createMockEnv({
      employee: {
        verifySecretAnswer: async () => ({ status: "locked" as const, minutesLeft: 15 }),
      },
    });
    const observation: Record<string, unknown> = {};
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = await createVerificationToken({
      employeeNumber: "1001",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds,
    });

    const result = await handleAnswerSecretQuestion(env, observation, "conv_abc", {
      verification_token: token,
      answer: "Red",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "locked",
    });
  });

  it("returns unauthenticated for expired token", async () => {
    const env = await createMockEnv();
    const observation: Record<string, unknown> = {};
    const token = await createVerificationToken({
      employeeNumber: "1001",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: 1_700_000_000,
    });

    const result = await handleAnswerSecretQuestion(env, observation, "conv_abc", {
      verification_token: token,
      answer: "Blue",
    });

    // Token is expired because Date.now() is much later than 1_700_000_000
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
  });

  it("returns unauthenticated for wrong conversation", async () => {
    const env = await createMockEnv();
    const observation: Record<string, unknown> = {};
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = await createVerificationToken({
      employeeNumber: "1001",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds,
    });

    const result = await handleAnswerSecretQuestion(env, observation, "wrong_conv", {
      verification_token: token,
      answer: "Blue",
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
  });
});
