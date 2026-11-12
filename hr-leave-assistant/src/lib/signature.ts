/** Maximum allowed clock skew when verifying webhook signatures (5 minutes). */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * Decodes a Base64 string into a Uint8Array.
 * Returns `null` if the string is not valid Base64.
 *
 * @param value - Base64-encoded string.
 * @returns Decoded bytes, or `null` on failure.
 */
function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Verifies an Ed25519 webhook signature from Telnyx.
 * Validates the timestamp is within skew, decodes the signature and public key,
 * and performs cryptographic verification of `timestamp|rawBody`.
 *
 * @param input - Object containing the raw body, request headers, public key, and optional current time.
 * @returns `true` if the signature is valid and fresh.
 */
export async function verifyTelnyxWebhookSignature(input: {
  rawBody: string;
  headers: Headers;
  publicKey: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const signatureHeader = input.headers.get("telnyx-signature-ed25519");
  const timestamp = input.headers.get("telnyx-timestamp");
  if (!signatureHeader || !timestamp || !/^\d+$/.test(timestamp)) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const signature = decodeBase64(signatureHeader);
  const publicKeyBytes = decodeBase64(input.publicKey);
  if (!signature || !publicKeyBytes || publicKeyBytes.byteLength !== 32) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signedBytes = new TextEncoder().encode(`${timestamp}|${input.rawBody}`);
    return await crypto.subtle.verify("Ed25519", key, signature as BufferSource, signedBytes);
  } catch {
    return false;
  }
}
