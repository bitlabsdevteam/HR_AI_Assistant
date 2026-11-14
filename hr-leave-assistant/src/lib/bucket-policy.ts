import type { CloudStorageBucket } from "@telnyx/edge-runtime";
import { parseCompanyProfile } from "../domain/profile";
import type { CompanyProfile, PolicyTopic } from "../config/default-profile";

/**
 * Loads the company profile from the HR policy bucket (Cloud Storage).
 * Reads the object at key `policy/current.json` and parses it.
 *
 * @param bucket - The Cloud Storage bucket binding.
 * @returns The parsed profile if the object exists and is valid; otherwise `null`.
 */
export async function loadPolicyFromBucket(
  bucket: CloudStorageBucket,
): Promise<CompanyProfile | null> {
  try {
    const obj = await bucket.get("policy/current.json");
    if (!obj || !("body" in obj)) {
      return null;
    }
    const raw = await obj.json();
    const profile = parseCompanyProfile(raw);
    if (!profile) {
      throw new Error("policy_parse_error");
    }
    return profile;
  } catch (error) {
    if (error instanceof Error && error.message === "policy_parse_error") {
      throw error;
    }
    throw new Error("policy_bucket_error");
  }
}

/**
 * Retrieves the policy answer for a topic, preferring Cloud Storage over KV fallback.
 * Returns the policy text and a source flag indicating where it came from.
 * If the bucket read or parse fails, the error is reported in `error` so the caller
 * can log the cause without failing the caller's response.
 *
 * @param bucket - The Cloud Storage bucket binding.
 * @param profile - The fallback company profile (from KV or bundled default).
 * @param topic - The policy topic to answer.
 * @returns Object with the answer text, the source (`"bucket"`, `"kv"`, or `"fallback"`),
 *   and an optional `error` describing why the bucket could not be used.
 */
export async function resolvePolicyAnswer(
  bucket: CloudStorageBucket,
  profile: CompanyProfile,
  topic: PolicyTopic,
): Promise<{
  answer: string;
  source: "bucket" | "kv" | "fallback";
  error?: "policy_bucket_error" | "policy_parse_error";
}> {
  try {
    const bucketProfile = await loadPolicyFromBucket(bucket);
    if (bucketProfile) {
      return { answer: bucketProfile.policy[topic], source: "bucket" };
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "policy_bucket_error") {
        return { answer: profile.policy[topic], source: "kv", error: "policy_bucket_error" };
      }
      if (error.message === "policy_parse_error") {
        return { answer: profile.policy[topic], source: "kv", error: "policy_parse_error" };
      }
    }
    throw error;
  }
  return { answer: profile.policy[topic], source: "kv" };
}
