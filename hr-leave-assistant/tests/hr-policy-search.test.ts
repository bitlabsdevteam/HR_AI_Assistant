import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/env";
import { searchPolicy, type PolicySearchResult } from "../src/lib/hr-policy";

const fakeEnv = (opts: { hasApiKey: boolean }): AppEnv =>
  ({
    SECRETS: {
      get: async (b: string) => (opts.hasApiKey && b === "TELNYX_API_KEY" ? "test-api-key" : undefined),
    },
    HR_KV: {} as AppEnv["HR_KV"],
    EMPLOYEE_LEAVE: {} as AppEnv["EMPLOYEE_LEAVE"],
    HR_DESK: {} as AppEnv["HR_DESK"],
    CALLER_PROFILE: {} as AppEnv["CALLER_PROFILE"],
  }) as AppEnv;

function makeFetchMock(
  overrides: {
    status?: number;
    json?: unknown;
    throwOnFetch?: boolean;
  } = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      if (overrides.throwOnFetch) {
        throw new Error("network error");
      }
      return {
        ok: overrides.status === undefined ? true : overrides.status >= 200 && overrides.status < 300,
        status: overrides.status ?? 200,
        clone: () => ({ json: async () => overrides.json }),
        json: async () => overrides.json,
      } as unknown as Response;
    }),
  );
}

const singleChunk: PolicySearchResult = {
  document_chunk: "Annual leave entitlement is 14 days per year.",
  distance: 0.2,
  metadata: {
    source: "https://storage.telnyx.com/hr-policy/handbook.pdf",
    checksum: "abc123",
    embedding: "intfloat/multilingual-e5-large",
    filename: "handbook.pdf",
    certainty: 0.91,
    loader_metadata: {},
  },
};

describe("searchPolicy", () => {
  it("returns chunks on a successful similarity search", async () => {
    makeFetchMock({
      json: {
        data: [singleChunk],
      },
    });
    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "annual leave entitlement");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results).toHaveLength(1);
      const first = result.results[0];
      expect(first).toBeDefined();
      expect(first!.document_chunk).toBe("Annual leave entitlement is 14 days per year.");
      expect(first!.metadata.certainty).toBe(0.91);
    }

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall?.[0]).toBe("https://api.telnyx.com/v2/ai/embeddings/similarity-search");
    expect(fetchCall?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      },
    });
    const body = JSON.parse((fetchCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      bucket_name: "hr-policy",
      query: "annual leave entitlement",
      num_of_docs: 3,
    });
  });

  it("returns unavailable when TELNYX_API_KEY is missing", async () => {
    makeFetchMock();
    const result = await searchPolicy(fakeEnv({ hasApiKey: false }), "annual leave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns unavailable on API non-2xx", async () => {
    makeFetchMock({ status: 500 });
    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "annual leave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
    }
  });

  it("returns not_found when the API returns zero chunks", async () => {
    makeFetchMock({ json: { data: [] } });
    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "does not exist topic");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
    }
  });

  it("returns unavailable on fetch network error", async () => {
    makeFetchMock({ throwOnFetch: true });
    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "annual leave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
    }
  });

  it("returns not_found on malformed API response", async () => {
    makeFetchMock({ json: { unexpected: true } });
    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "annual leave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
    }
  });

  it("returns unavailable on timeout (AbortController)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }),
    );

    const result = await searchPolicy(fakeEnv({ hasApiKey: true }), "annual leave");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unavailable");
    }
  }, 10_000);
});
