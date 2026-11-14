/**
 * Possible outcomes for a completed request, used in structured logging.
 * These values are emitted as the `outcome` field in completion logs.
 */
export type LogOutcome =
  | "ready"
  | "degraded"
  | "ok"
  | "verified"
  | "auth_failed"
  | "locked"
  | "approved"
  | "cancelled"
  | "replayed"
  | "insufficient_balance"
  | "overlap"
  | "out_of_policy"
  | "not_found"
  | "changes_paused"
  | "queued"
  | "invalid_input"
  | "method_not_allowed"
  | "unauthenticated"
  | "unauthorized"
  | "error";

/**
 * Structured log entry written at the end of every webhook, tool, admin, or ops request.
 * Follows the TDD §10.1 shape and always carries `call_ref`.
 */
export interface CompletionLog {
  /** The type of event that completed. */
  event: "webhook.completed" | "tool.completed" | "admin.completed" | "ops.completed" | "router.completed";
  /** Unique reference for this call (or "none" for non-call contexts). */
  call_ref: string;
  /** High-level outcome of the request. */
  outcome: LogOutcome;
  /** HTTP status code returned. */
  status: number;
  /** Total request duration in milliseconds. */
  duration_ms: number;
  /** Log severity level (defaults to "info"). */
  level?: "info" | "warn" | "error";
  /** Telnyx conversation ID, if available. */
  conversation_id?: string;
  /** Pseudonym of the caller (first 8 hex chars of HMAC). */
  caller?: string;
  /** Pseudonym of the employee (first 8 hex chars of HMAC). */
  emp?: string;
  /** Workflow node that handled the request. */
  node?: string;
  /** MCP tool name that was invoked. */
  tool?: string;
  /** Time spent waiting for actor calls in milliseconds. */
  actor_ms?: number;
  /** Whether KV read was a hit, missing, or errored. */
  kv?: "hit" | "missing" | "error";
  /** What happened to the Langfuse trace export: sent, skipped, failed, or off. */
  trace?: "sent" | "skipped" | "failed" | "off";
  /** Request path, for router events that hit an unknown route. Query string is excluded. */
  path?: string;
  /** Additional detail for debugging (e.g. "invalid_payload", "kv_missing"). */
  detail?:
    | "invalid_payload"
    | "missing_hash_key"
    | "missing_conversation_id"
    | "invalid_conversation_id"
    | "actor_unavailable"
    | "kv_missing"
    | "kv_error"
    | "policy_bucket_error"
    | "policy_parse_error";
  /** Names of dependencies that failed during an ops check. */
  failed?: string[];
  /** Per-dependency timing in milliseconds (ops check). */
  deps_ms?: Record<string, number>;
  /** Actor-level event describing the state-changing outcome of an actor call. */
  actor_event?: string;
}

/**
 * Writes a single structured JSON log line to stdout.
 * This is the project's only logging path; every request writes exactly one line
 * in its `finally` block.
 *
 * @param fields - The completion log fields to emit.
 */
export function writeCompletionLog(fields: CompletionLog): void {
  const line = {
    ts: new Date().toISOString(),
    ...fields,
    level: fields.level ?? "info",
  };
  console.log(JSON.stringify(line));
}
