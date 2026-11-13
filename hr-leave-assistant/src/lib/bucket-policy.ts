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
    return parseCompanyProfile(raw);
  } catch {
    return null;
  }
}

/**
 * Retrieves the policy answer for a topic, preferring Cloud Storage over KV fallback.
 * Returns the policy text and a source flag indicating where it came from.
 *
 * @param bucket - The Cloud Storage bucket binding.
 * @param profile - The fallback company profile (from KV or bundled default).
 * @param topic - The policy topic to answer.
 * @returns Object with the answer text and the source (`"bucket"`, `"kv"`, or `"fallback"`).
 */
export async function resolvePolicyAnswer(
  bucket: CloudStorageBucket,
  profile: CompanyProfile,
  topic: PolicyTopic,
): Promise<{ answer: string; source: "bucket" | "kv" | "fallback" }> {
  const bucketProfile = await loadPolicyFromBucket(bucket);
  if (bucketProfile) {
    return { answer: bucketProfile.policy[topic], source: "bucket" };
  }
  return { answer: profile.policy[topic], source: "kv" };
}
