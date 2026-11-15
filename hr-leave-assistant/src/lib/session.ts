import { z } from "zod";
import { callerActorName } from "./identity";
import type { AppEnv } from "../env";

/** Session record stored in KV per caller. Versioned for safe evolution. */
const sessionRecordSchema = z.object({
  v: z.literal(1),
  last_call_at: z.string().datetime(),
  last_call_ref: z.string(),
  last_call_id_hash: z.string(),
  last_outcome: z.enum(["ready", "degraded"]),
});

/** Parsed caller session record. */
export type CallerSessionRecord = z.infer<typeof sessionRecordSchema>;

/** Maximum age in milliseconds for a caller to be considered recent (30 minutes). */
const RECENT_WINDOW_MS = 30 * 60 * 1000;

/** KV write timeout for the blind session write (milliseconds). */
const SESSION_WRITE_TIMEOUT_MS = 300;

/** TTL for session KV records (24 hours in seconds). */
const SESSION_TTL_SECONDS = 86400;

/**
 * Builds the KV key for a caller session.
 * Uses the existing `caller|` HMAC prefix via `callerActorName`.
 * The key contains no colons (KV rejects them) and is well under the 256-character limit.
 *
 * @param hashKey - The secret HMAC key.
 * @param phoneNumber - The caller's phone number.
 * @returns KV key string like `session/caller/<64-hex-hmac>`.
 */
export async function callerSessionKey(hashKey: string, phoneNumber: string): Promise<string> {
  const actorName = await callerActorName(hashKey, phoneNumber);
  return `session/caller/${actorName}`;
}

/**
 * Loads a caller session from KV and validates its shape.
 * Returns `missing` when the key is absent, JSON is malformed, version is unknown,
 * or the stored `last_call_id_hash` matches the current call (retry protection).
 * Returns `error` only when KV itself throws or the deadline is exceeded.
 *
 * @param env - The application environment.
 * @param key - The KV key.
 * @param callIdHash - First 16 hex chars of SHA-256 of the current call_control_id.
 * @returns State and, on a hit, whether the caller is recent.
 */
export async function loadCallerSession(
  env: AppEnv,
  key: string,
  callIdHash: string,
): Promise<{ state: "hit" | "missing" | "error"; recent?: boolean }> {
  try {
    const stored = await env.HR_KV.get<unknown>(key, { type: "json" });
    if (stored === null) {
      return { state: "missing" };
    }
    const parsed = sessionRecordSchema.safeParse(stored);
    if (!parsed.success) {
      return { state: "missing" };
    }
    const record = parsed.data;
    if (record.last_call_id_hash === callIdHash) {
      return { state: "missing" };
    }
    const recent = isRecentCaller(new Date(record.last_call_at), new Date());
    return { state: "hit", recent };
  } catch {
    return { state: "error" };
  }
}

/**
 * Saves a caller session record to KV with a 24-hour TTL.
 * Never throws. Times out after 300 ms to avoid delaying the response.
 *
 * @param env - The application environment.
 * @param key - The KV key.
 * @param record - The session record to write.
 * @returns `true` when the write succeeded, `false` on failure or timeout.
 */
export async function saveCallerSession(
  env: AppEnv,
  key: string,
  record: CallerSessionRecord,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), SESSION_WRITE_TIMEOUT_MS);
    env.HR_KV.put(key, JSON.stringify(record), { expirationTtl: SESSION_TTL_SECONDS })
      .then(() => {
        clearTimeout(timer);
        resolve(true);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

/**
 * Determines whether a previous call is within the recency window.
 *
 * @param lastCallAt - Timestamp of the previous call.
 * @param now - Current timestamp.
 * @returns `true` when the call is within 30 minutes inclusive.
 */
export function isRecentCaller(lastCallAt: Date, now: Date): boolean {
  const diffMs = now.getTime() - lastCallAt.getTime();
  return diffMs >= 0 && diffMs <= RECENT_WINDOW_MS;
}
