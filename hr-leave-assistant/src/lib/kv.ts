import { DEFAULT_PROFILE, type CompanyProfile } from "../config/default-profile";
import { parseCompanyProfile } from "../domain/profile";
import type { AppEnv } from "../env";

/**
 * Combined company context loaded from KV at the start of a call.
 * Includes the validated profile, the leave-changes feature flag, and KV hit status.
 */
export interface CompanyContext {
  /** The active company profile (from KV or bundled fallback). */
  profile: CompanyProfile;
  /** Whether employees are currently allowed to apply or cancel leave. */
  leaveChangesEnabled: boolean;
  /** Whether all KV reads succeeded ("hit") or fell back to defaults ("fallback"). */
  kv: "hit" | "fallback";
}

/**
 * Loads the company profile from KV storage.
 * Falls back to the bundled `DEFAULT_PROFILE` if the KV entry is missing or invalid.
 *
 * @param env - The application environment with KV bindings.
 * @returns The profile and a flag indicating whether KV was hit.
 */
export async function loadCompanyProfile(
  env: AppEnv,
): Promise<{ profile: CompanyProfile; kv: "hit" | "fallback" }> {
  try {
    const stored = await env.HR_KV.get<unknown>("profile/current", { type: "json" });
    const profile = parseCompanyProfile(stored);
    if (profile) {
      return { profile, kv: "hit" };
    }
  } catch {
    // The bundled policy is the deliberate, non-sensitive fallback.
  }
  return { profile: DEFAULT_PROFILE, kv: "fallback" };
}

/**
 * Loads the leave-changes feature flag from KV.
 * Falls back to `true` (enabled) if the flag is missing or unreadable.
 *
 * @param env - The application environment with KV bindings.
 * @returns Whether leave changes are enabled and the KV hit status.
 */
export async function loadLeaveChangesFlag(
  env: AppEnv,
): Promise<{ enabled: boolean; kv: "hit" | "fallback" }> {
  try {
    const value = await env.HR_KV.get("flags/leave_changes_enabled");
    if (value === "true" || value === "false") {
      return { enabled: value === "true", kv: "hit" };
    }
  } catch {
    // A failed or absent flag does not disable read-only functionality.
  }
  return { enabled: true, kv: "fallback" };
}

/**
 * Loads the full company context by reading both the profile and the leave-changes flag in parallel.
 *
 * @param env - The application environment with KV bindings.
 * @returns Combined company context.
 */
export async function loadCompanyContext(env: AppEnv): Promise<CompanyContext> {
  const [profileResult, flagResult] = await Promise.all([
    loadCompanyProfile(env),
    loadLeaveChangesFlag(env),
  ]);

  return {
    profile: profileResult.profile,
    leaveChangesEnabled: flagResult.enabled,
    kv: profileResult.kv === "hit" && flagResult.kv === "hit" ? "hit" : "fallback",
  };
}
