import { describe, expect, it } from "vitest";
import type { ActorContext, Env } from "@telnyx/edge-runtime";
import { EmployeeLeave } from "../src/actors/employee-leave";

const HASH_64 = "0000000000000000000000000000000000000000000000000000000000000000";
const WRONG_1 = "1111111111111111111111111111111111111111111111111111111111111111";
const WRONG_2 = "2222222222222222222222222222222222222222222222222222222222222222";
const WRONG_3 = "3333333333333333333333333333333333333333333333333333333333333333";
const ANS_HASH = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

function createMockActor() {
  const storage = new Map<string, unknown>();
  const actor = new EmployeeLeave(
    {
      id: "test",
      storage: {
        get: async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined,
        put: async (key: string, value: unknown): Promise<void> => { storage.set(key, value); },
        delete: async (key: string): Promise<void> => { storage.delete(key); },
        deleteAll: async (): Promise<void> => { storage.clear(); },
        list: async () => new Map(),
      },
      blockConcurrencyWhile: async <T>(fn: () => T | Promise<T>): Promise<T> => fn(),
      setAlarm: async (): Promise<void> => {},
      count: async (): Promise<number> => 0,
      broadcast: async (): Promise<void> => {},
      sockets: async (): Promise<unknown[]> => [],
    } as unknown as ActorContext,
    {} as Env,
  );
  return { actor, storage };
}

const seed = {
  firstName: "Alex",
  entitlementDays: 14,
  openingUsedDays: 6,
  pinHash: HASH_64,
  secretQuestion: "What is your favourite colour?",
  secretAnswerHash: ANS_HASH,
};

describe("EmployeeLeave secret question verification", () => {
  it("returns ok when the supplied answer matches the stored hash", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);
    const result = await actor.verifySecretAnswer(ANS_HASH, "2026-11-13T12:00:00Z");
    expect(result).toMatchObject({ status: "ok", firstName: "Alex" });
  });

  it("returns failed when the answer does not match", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);
    const result = await actor.verifySecretAnswer(WRONG_1, "2026-11-13T12:00:00Z");
    expect(result).toMatchObject({ status: "failed", attemptsLeft: 2 });
  });

  it("tracks failed attempts across verifyPin and verifySecretAnswer", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);

    // 1 wrong PIN
    const pin1 = await actor.verifyPin(WRONG_1, "2026-11-13T12:00:00Z");
    expect(pin1).toMatchObject({ status: "failed", attemptsLeft: 2 });

    // 2 wrong secret answer (now total 2 failures in session)
    const ans1 = await actor.verifySecretAnswer(WRONG_2, "2026-11-13T12:00:00Z");
    expect(ans1).toMatchObject({ status: "failed", attemptsLeft: 1 });

    // 3rd wrong answer → lockout
    const ans2 = await actor.verifySecretAnswer(WRONG_3, "2026-11-13T12:00:00Z");
    expect(ans2).toMatchObject({ status: "locked", minutesLeft: 15 });
  });

  it("resets failures after a correct answer", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);

    // Wrong attempt first
    await actor.verifySecretAnswer(WRONG_1, "2026-11-13T12:00:00Z");

    // Correct answer resets counter
    const result = await actor.verifySecretAnswer(ANS_HASH, "2026-11-13T12:00:00Z");
    expect(result).toMatchObject({ status: "ok", firstName: "Alex" });

    // Next wrong starts from 1 again
    const nextWrong = await actor.verifySecretAnswer(WRONG_2, "2026-11-13T12:00:00Z");
    expect(nextWrong).toMatchObject({ status: "failed", attemptsLeft: 2 });
  });

  it("returns ok when no secret question is configured (backwards compatible)", async () => {
    const { actor } = createMockActor();
    await actor.reset({
      ...seed,
      secretQuestion: null,
      secretAnswerHash: null,
    });
    const result = await actor.verifySecretAnswer(HASH_64, "2026-11-13T12:00:00Z");
    expect(result).toMatchObject({ status: "ok", firstName: "Alex" });
  });

  it("setSecretQuestion migrates missing fields lazily", async () => {
    const { actor, storage } = createMockActor();
    await actor.reset({
      firstName: "Alex",
      entitlementDays: 14,
      openingUsedDays: 6,
      pinHash: HASH_64,
    });

    // Before migration: profile lacks secret fields
    const profileBefore = await storage.get("profile") as Record<string, unknown>;
    expect(profileBefore.secretQuestion).toBeNull();
    expect(profileBefore.secretAnswerHash).toBeNull();

    // Migrate
    const migrateResult = await actor.setSecretQuestion(seed.secretQuestion, ANS_HASH);
    expect(migrateResult).toBe("ok");

    // After migration: fields present
    const profileAfter = await storage.get("profile") as Record<string, unknown>;
    expect(profileAfter.secretQuestion).toBe("What is your favourite colour?");
    expect(profileAfter.secretAnswerHash).toBe(ANS_HASH);
  });

  it("setSecretQuestion is idempotent (skipped when fields present)", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);
    const result = await actor.setSecretQuestion("New question", "newhash");
    expect(result).toBe("skipped");
  });

  it("throws on invalid input", async () => {
    const { actor } = createMockActor();
    await actor.reset(seed);
    await expect(actor.verifySecretAnswer("short", "2026-11-13T12:00:00Z")).rejects.toThrow("Invalid secret answer verification input");
    await expect(actor.verifySecretAnswer(ANS_HASH, "invalid-time")).rejects.toThrow("Invalid secret answer verification input");
  });
});
