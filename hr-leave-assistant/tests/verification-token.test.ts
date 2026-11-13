import { describe, expect, it } from "vitest";
import {
  createVerificationToken,
  verifyVerificationToken,
} from "../src/lib/verification-token";

const NOW = 1_700_000_000;
const HASH_KEY = "test-hash-key-for-verification-token";

describe("verification token", () => {
  it("creates and verifies a valid token", async () => {
    const token = await createVerificationToken({
      employeeNumber: "1234",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW,
    });

    const result = await verifyVerificationToken({
      token,
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW + 30,
    });
    expect(result).toBe("1234");
  });

  it("rejects an expired token", async () => {
    const token = await createVerificationToken({
      employeeNumber: "1234",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW,
    });

    const result = await verifyVerificationToken({
      token,
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW + 3 * 60, // 3 minutes later
    });
    expect(result).toBeNull();
  });

  it("rejects a token with the wrong conversation id", async () => {
    const token = await createVerificationToken({
      employeeNumber: "1234",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW,
    });

    const result = await verifyVerificationToken({
      token,
      hashKey: HASH_KEY,
      conversationId: "other_conv",
      nowSeconds: NOW + 30,
    });
    expect(result).toBeNull();
  });

  it("rejects a token with the wrong hash key", async () => {
    const token = await createVerificationToken({
      employeeNumber: "1234",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW,
    });

    const result = await verifyVerificationToken({
      token,
      hashKey: "different-key",
      conversationId: "conv_abc",
      nowSeconds: NOW + 30,
    });
    expect(result).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const result = await verifyVerificationToken({
      token: "not-a-token",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW + 30,
    });
    expect(result).toBeNull();
  });

  it("has a distinct prefix from auth tokens", async () => {
    const token = await createVerificationToken({
      employeeNumber: "1234",
      hashKey: HASH_KEY,
      conversationId: "conv_abc",
      nowSeconds: NOW,
    });
    expect(token.startsWith("temp1.")).toBe(true);
    expect(token.startsWith("v1.")).toBe(false);
  });
});
