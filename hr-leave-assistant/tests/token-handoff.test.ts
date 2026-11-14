import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHrLeaveMcpServer } from "../src/tools";
import type { AppEnv } from "../src/env";

const HASH_KEY = "test-hash-key-for-token-handoff";

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

function createEnv(summary = vi.fn(async () => ({
  firstName: "Alex",
  entitlementDays: 14,
  usedDays: 6,
  remainingDays: 8,
  upcoming: [],
}))) {
  const env = {
    SECRETS: { get: async (name: string) => (name === "HASH_KEY" ? HASH_KEY : undefined) },
    HR_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    EMPLOYEE_LEAVE: {
      idFromName: () => ({
        verifyPin: async () => ({ status: "ok" as const, firstName: "Alex" }),
        summary,
      }),
    },
  } as unknown as AppEnv;
  return { env, summary };
}

async function connect(env: AppEnv, conversationId: string) {
  const server = createHrLeaveMcpServer(env, {}, conversationId);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Reads the text block the way a text-only MCP consumer would. */
function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0]!.text;
}

async function verify(client: Client) {
  return client.callTool({
    name: "verify_employee",
    arguments: { employee_number: "1001", pin: "1111" },
  });
}

describe("verify_employee to get_leave_balance token handoff", () => {
  it("exposes the issued token in the text block and completes the balance lookup", async () => {
    const { env, summary } = createEnv();
    const client = await connect(env, "conv_handoff");

    const verified = await verify(client);
    const envelope = JSON.parse(textOf(verified));
    expect(envelope).toMatchObject({
      ok: true,
      message: "Welcome, Alex.",
      data: { auth_token: expect.stringMatching(/^v1\.1001\.\d+\.[0-9a-f]{32}$/), first_name: "Alex" },
    });

    const balance = await client.callTool({
      name: "get_leave_balance",
      arguments: { auth_token: envelope.data.auth_token },
    });
    expect(balance.isError).toBeFalsy();
    expect(JSON.parse(textOf(balance))).toMatchObject({
      ok: true,
      data: { entitlement_days: 14, used_days: 6, remaining_days: 8 },
    });
    expect(summary).toHaveBeenCalledOnce();
  });

  it("keeps structuredContent identical in shape alongside the text envelope", async () => {
    const { env } = createEnv();
    const client = await connect(env, "conv_handoff");
    const verified = await verify(client);
    expect(verified.structuredContent).toMatchObject({
      ok: true,
      data: { auth_token: expect.stringMatching(/^v1\./), first_name: "Alex" },
    });
  });

  it.each([
    ["the employee number", () => "1001"],
    ["the welcome greeting", () => "Welcome, Alex."],
    ["a four-digit PIN", () => "1111"],
  ])("rejects %s passed as auth_token and never reads the balance", async (_label, value) => {
    const { env, summary } = createEnv();
    const client = await connect(env, "conv_handoff");
    await verify(client);

    const balance = await client.callTool({
      name: "get_leave_balance",
      arguments: { auth_token: value() },
    });
    expect(balance.isError).toBe(true);
    expect(JSON.parse(textOf(balance))).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(summary).not.toHaveBeenCalled();
  });

  it("rejects a token issued for a different conversation", async () => {
    const { env, summary } = createEnv();
    const issuer = await connect(env, "conv_one");
    const token = JSON.parse(textOf(await verify(issuer))).data.auth_token as string;

    const other = await connect(env, "conv_two");
    const balance = await other.callTool({ name: "get_leave_balance", arguments: { auth_token: token } });
    expect(balance.isError).toBe(true);
    expect(JSON.parse(textOf(balance))).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(summary).not.toHaveBeenCalled();
  });
});
