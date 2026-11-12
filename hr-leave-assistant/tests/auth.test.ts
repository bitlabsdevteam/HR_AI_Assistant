import { describe, expect, it } from "vitest";
import { bearerCredentials, constantTimeEqual, hasValidBearer } from "../src/lib/auth";
import { hmacSha256Hex } from "../src/lib/identity";

describe("constant-time credential comparison", () => {
  it("matches only identical values", () => {
    expect(constantTimeEqual("same-value", "same-value")).toBe(true);
    expect(constantTimeEqual("same-value", "same-Value")).toBe(false);
    expect(constantTimeEqual("short", "longer")).toBe(false);
  });

  it("accepts the expected bearer and rejects missing, wrong, or malformed credentials", () => {
    const request = new Request("https://example.test/mcp", {
      headers: { authorization: "Bearer expected-secret" },
    });
    expect(bearerCredentials(request)).toBe("expected-secret");
    expect(hasValidBearer(request, "expected-secret")).toBe(true);
    expect(hasValidBearer(request, "different-secret")).toBe(false);
    expect(hasValidBearer(new Request("https://example.test/mcp"), "expected-secret")).toBe(false);
    expect(hasValidBearer(request, undefined)).toBe(false);
  });
});

describe("HMAC-SHA-256", () => {
  it("matches the published known-answer vector", async () => {
    await expect(
      hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
    ).resolves.toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});
