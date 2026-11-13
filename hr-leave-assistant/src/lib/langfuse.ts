import type { LogOutcome } from "./log";

/**
 * Metadata keys that may be attached to a Langfuse span.
 * The TDD §10.5 defines this allowlist explicitly.
 * Anything else is dropped before the OTLP payload is built.
 */
const ALLOWLIST = new Set([
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
]);

/** Maximum milliseconds to wait for the OTLP export. */
const OTLP_TIMEOUT_MS = 300;

/** Credentials needed to post spans to Langfuse. */
interface LangfuseCredentials {
  publicKey: string;
  secretKey: string;
  host: string;
}

/** Input describing one span to export. */
export interface SpanExportInput {
  /** Name shown in Langfuse (usually the tool name). */
  spanName: string;
  /** Epoch milliseconds when the span started. */
  startTime: number;
  /** Epoch milliseconds when the span ended. */
  endTime: number;
  /** Outcome of the request (controls the observation level). */
  outcome: LogOutcome;
  /** Allow-listed metadata. Only keys in ALLOWLIST are forwarded. */
  metadata?: Record<string, unknown>;
}

/**
 * What happened to the Langfuse export attempt.
 * - `off`     : one or more Langfuse secrets are missing.
 * - `skipped` : no conversation_id was available to build a trace ID.
 * - `sent`    : HTTP 2xx from Langfuse.
 * - `failed`  : network error, timeout, or non-2xx response.
 */
export type TraceStatus = "sent" | "skipped" | "failed" | "off";

/**
 * Computes the Langfuse trace ID for a conversation.
 * Contract per Telnyx docs: first 32 hex characters of the SHA-256 of the UTF-8 conversation_id.
 *
 * @param conversationId - The Telnyx conversation ID.
 * @returns 32-character hex trace ID.
 */
export async function computeTraceId(conversationId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(conversationId),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hex.slice(0, 32);
}

/**
 * Attempts to export one OTLP span to Langfuse.
 * Best effort: never throws, never blocks longer than {@link OTLP_TIMEOUT_MS}.
 *
 * @param credentials - Langfuse keys and host (all three must be present).
 * @param input - Span description.
 * @returns What happened to the export.
 */
export async function exportSpan(
  credentials: LangfuseCredentials | undefined,
  input: SpanExportInput,
): Promise<TraceStatus> {
  if (!credentials) {
    return "off";
  }

  const conversationId = input.metadata?.conversation_id;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return "skipped";
  }

  const traceId = await computeTraceId(conversationId);
  const spanId = generateSpanId();

  // Build allow-listed attributes only.
  const attributes: { key: string; value: { stringValue?: string; intValue?: number } }[] = [];
  if (input.metadata) {
    for (const key of ALLOWLIST) {
      const raw = input.metadata[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw === "string") {
        attributes.push({ key, value: { stringValue: raw } });
      } else if (typeof raw === "number" && Number.isFinite(raw)) {
        attributes.push({ key, value: { intValue: Math.round(raw) } });
      }
    }
  }

  // langfuse.observation.type classifies this observation in Langfuse.
  attributes.push({
    key: "langfuse.observation.type",
    value: { stringValue: "tool" },
  });

  // langfuse.observation.level drives the icon colour in the Langfuse UI.
  attributes.push({
    key: "langfuse.observation.level",
    value: { stringValue: outcomeToLevel(input.outcome) },
  });

  const otlpBody = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "hr-leave-assistant" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "hr-leave-assistant", version: "0.1.0" },
            spans: [
              {
                traceId,
                spanId,
                name: input.spanName,
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: String(input.startTime * 1_000_000),
                endTimeUnixNano: String(input.endTime * 1_000_000),
                status: { code: 0 }, // OK — Langfuse reads the level from attributes
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };

  const auth = btoa(`${credentials.publicKey}:${credentials.secretKey}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OTLP_TIMEOUT_MS);

    const response = await fetch(`${credentials.host}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify(otlpBody),
      signal: controller.signal,
    });

    clearTimeout(timer);
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Reads Langfuse credentials from the Edge secrets binding.
 * Returns `undefined` when any of the three secrets is missing.
 *
 * @param env - The application environment.
 * @returns Credentials object or undefined.
 */
export async function loadLangfuseCredentials(env: {
  SECRETS: { get(name: string): Promise<string | undefined> };
}): Promise<LangfuseCredentials | undefined> {
  try {
    const [publicKey, secretKey, host] = await Promise.all([
      env.SECRETS.get("LANGFUSE_PUBLIC_KEY"),
      env.SECRETS.get("LANGFUSE_SECRET_KEY"),
      env.SECRETS.get("LANGFUSE_HOST"),
    ]);

    if (!publicKey || !secretKey || !host) {
      return undefined;
    }

    return { publicKey, secretKey, host };
  } catch {
    // Secrets binding may throw (e.g. HTTP 404) when a secret is not configured.
    // Treat this as "tracing off" rather than failing the request.
    return undefined;
  }
}

/**
 * Tests whether a key is on the Langfuse span allowlist.
 * Exported so tests can verify the gate without relying on the export machinery.
 *
 * @param key - The metadata key to test.
 * @returns True when the key may appear in a span payload.
 */
export function isAllowlisted(key: string): boolean {
  return ALLOWLIST.has(key);
}

/** Maps an outcome to the Langfuse observation level. */
function outcomeToLevel(outcome: LogOutcome): "DEFAULT" | "WARNING" | "ERROR" {
  if (outcome === "error") {
    return "ERROR";
  }
  if (
    outcome === "auth_failed" ||
    outcome === "locked" ||
    outcome === "insufficient_balance" ||
    outcome === "overlap" ||
    outcome === "out_of_policy" ||
    outcome === "not_found" ||
    outcome === "changes_paused" ||
    outcome === "unauthenticated" ||
    outcome === "unauthorized"
  ) {
    return "WARNING";
  }
  return "DEFAULT";
}

/** Generates an 8-byte random span ID as 16 hex characters. */
function generateSpanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
