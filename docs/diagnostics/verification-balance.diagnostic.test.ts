// Diagnostic harness, separate from the application test suite.
// Calls the real MCP HTTP handler, real token functions and real EmployeeLeave
// methods. Only durable storage and platform secret/KV bindings are in memory.
import { afterEach, beforeEach, describe, expect, it, vi } from '../../hr-leave-assistant/node_modules/vitest/dist/index.js';
import { handleMcp } from '../../hr-leave-assistant/src/mcp';
import { EmployeeLeave } from '../../hr-leave-assistant/src/actors/employee-leave';
import { DEFAULT_EMPLOYEES } from '../../hr-leave-assistant/src/config/default-employees';
import { employeeActorName, pinHash } from '../../hr-leave-assistant/src/lib/identity';
import type { AppEnv } from '../../hr-leave-assistant/src/env';

const HASH_KEY = 'diagnostic-only-hash-key';
const MCP_BEARER = 'diagnostic-only-bearer';
const CONVERSATION = 'diagnostic-conversation';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const employee = DEFAULT_EMPLOYEES[0]!;
  const storage = new Map<string, unknown>();
  const actor = new EmployeeLeave({
    id: 'diagnostic',
    storage: {
      get: async (key: string) => structuredClone(storage.get(key)),
      put: async (key: string, value: unknown) => { storage.set(key, structuredClone(value)); },
      delete: async (key: string) => { storage.delete(key); },
      deleteAll: async () => { storage.clear(); },
      list: async () => new Map(),
    },
    blockConcurrencyWhile: async (fn: () => unknown) => fn(),
  } as never, {} as never);
  await actor.reset({ firstName: employee.firstName, entitlementDays: 14,
    openingUsedDays: 6, pinHash: await pinHash(HASH_KEY, employee.employeeNumber, employee.pin) });
  const expectedActorName = await employeeActorName(HASH_KEY, employee.employeeNumber);
  const summary = vi.spyOn(actor, 'summary');
  const env = {
    SECRETS: { get: async (name: string) => name === 'HASH_KEY' ? HASH_KEY : name === 'MCP_BEARER' ? MCP_BEARER : undefined },
    HR_KV: { get: async () => null },
    EMPLOYEE_LEAVE: { idFromName: (name: string) => {
      if (name !== expectedActorName) throw new Error('Unexpected employee actor');
      return actor;
    } },
  } as unknown as AppEnv;
  let id = 0;
  async function call(name: string, args: Record<string, unknown>, conversation = CONVERSATION) {
    const request = new Request('https://diagnostic.invalid/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MCP_BEARER}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call',
        params: { name, arguments: args, _meta: { telnyx_conversation_id: conversation } } }),
    });
    const response = await handleMcp(request, env);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Boolean(payload.error)).toBe(false);
    return payload.result;
  }
  const verify = () => call('verify_employee', { employee_number: employee.employeeNumber, pin: employee.pin });
  return { call, verify, summary, employeeNumber: employee.employeeNumber };
}

describe('verification to balance diagnostic', () => {
  it('returns the correct balance when the issued token is forwarded unchanged', async () => {
    const { call, verify, summary } = await fixture();
    const verified = await verify();
    expect(verified.structuredContent.ok).toBe(true);
    const balance = await call('get_leave_balance', { auth_token: verified.structuredContent.data.auth_token });
    expect(balance.structuredContent.ok).toBe(true);
    expect(balance.structuredContent.data.remaining_days).toBe(8);
    expect(balance.structuredContent.data.used_days).toBe(6);
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it('rejects a token from another conversation before reading the balance', async () => {
    const { call, verify, summary } = await fixture();
    const verified = await verify();
    const balance = await call('get_leave_balance', { auth_token: verified.structuredContent.data.auth_token }, 'different-conversation');
    expect(balance.structuredContent.code).toBe('unauthenticated');
    expect(summary).not.toHaveBeenCalled();
  });

  it('reproduces the captured employee-number-as-token failure before reading the balance', async () => {
    const { call, verify, summary, employeeNumber } = await fixture();
    const verified = await verify();
    expect(verified.structuredContent.ok).toBe(true);
    const balance = await call('get_leave_balance', { auth_token: employeeNumber });
    expect(balance.structuredContent.code).toBe('unauthenticated');
    expect(summary).not.toHaveBeenCalled();
  });

  it('supplies the issued token through MCP text content and completes the balance lookup', async () => {
    const { call, verify, summary } = await fixture();
    const verified = await verify();
    const text = verified.content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('\n');
    let projected: { data?: { auth_token?: string } } = {};
    try { projected = JSON.parse(text); } catch { /* Plain greeting has no token. */ }
    // Compare only a boolean so test output cannot disclose a credential.
    expect(projected.data?.auth_token === verified.structuredContent.data.auth_token).toBe(true);
    const balance = await call('get_leave_balance', { auth_token: projected.data!.auth_token });
    expect(balance.structuredContent.ok).toBe(true);
    expect(balance.structuredContent.data.remaining_days).toBe(8);
    expect(summary).toHaveBeenCalledTimes(1);
  });
});
