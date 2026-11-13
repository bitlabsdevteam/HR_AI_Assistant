import type { AppEnv } from "../env";

export const HR_POLICY_BUCKET = "hr-policy";

/** One chunk returned by the Telnyx similarity-search API. */
export interface PolicySearchResult {
  document_chunk: string;
  distance: number;
  metadata: {
    source: string;
    checksum: string;
    embedding: string;
    filename: string;
    certainty: number;
    loader_metadata: unknown;
  };
}

/**
 * Queries the Telnyx Embeddings API for policy chunks matching a search query.
 * Uses the similarity-search endpoint over the hr-policy bucket.
 *
 * @param env - The application environment with secrets binding.
 * @param query - The plain-text query to search for.
 * @returns `ok: true` with up to 3 matching chunks, or `ok: false` with code.
 */
export async function searchPolicy(
  env: AppEnv,
  query: string,
): Promise<{ ok: true; results: PolicySearchResult[] } | { ok: false; code: "unavailable" | "not_found" }> {
  const apiKey = await env.SECRETS.get("TELNYX_API_KEY");
  if (!apiKey) {
    return { ok: false, code: "unavailable" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3_500);

    try {
      const response = await fetch("https://api.telnyx.com/v2/ai/embeddings/similarity-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          bucket_name: HR_POLICY_BUCKET,
          query,
          num_of_docs: 3,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, code: "unavailable" };
      }

      const body = (await response.json()) as unknown;
      const results = extractSearchResults(body);
      if (!results || results.length === 0) {
        return { ok: false, code: "not_found" };
      }

      return { ok: true, results };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

/** Parses the array of results from the similarity-search response body. */
function extractSearchResults(body: unknown): PolicySearchResult[] | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;

  const results: PolicySearchResult[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const doc = item as Record<string, unknown>;

    const chunk = doc.document_chunk;
    const distance = doc.distance;
    const meta = doc.metadata;
    if (typeof chunk !== "string") continue;
    if (typeof distance !== "number") continue;
    if (typeof meta !== "object" || meta === null) continue;

    const m = meta as Record<string, unknown>;
    const filename = m.filename;
    const certainty = m.certainty;
    if (typeof filename !== "string") continue;
    if (typeof certainty !== "number") continue;

    results.push({
      document_chunk: chunk,
      distance,
      metadata: m as PolicySearchResult["metadata"],
    });
  }

  return results.length > 0 ? results : null;
}
