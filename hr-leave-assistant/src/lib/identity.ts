/** Shared encoder for turning strings into bytes before hashing. */
const textEncoder = new TextEncoder();

/**
 * Alphabet used for generating human-readable reference codes.
 * Excludes ambiguous characters (0, O, 1, I) for readability over the phone.
 */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Imports a raw secret string into an HMAC-SHA-256 CryptoKey.
 *
 * @param secret - The raw secret bytes as a string.
 * @returns A CryptoKey suitable for HMAC signing.
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Converts a Uint8Array into a lowercase hexadecimal string.
 *
 * @param bytes - The bytes to encode.
 * @returns Hexadecimal string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes the HMAC-SHA-256 of a message under a secret, returning a hex string.
 *
 * @param secret - The HMAC secret.
 * @param input - The message to sign.
 * @returns Hexadecimal HMAC digest.
 */
export async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(input));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Computes the raw SHA-256 hash of a message, returning a hex string.
 *
 * @param input - The message to hash.
 * @returns Hexadecimal SHA-256 digest.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Generates a short pseudonym for a caller phone number.
 * Returns the first 8 hex characters of an HMAC.
 *
 * @param hashKey - The secret HMAC key.
 * @param phoneNumber - The caller's phone number.
 * @returns A short pseudonym string (e.g. "a3f7e2d1").
 */
export async function callerPseudonym(hashKey: string, phoneNumber: string): Promise<string> {
  return (await hmacSha256Hex(hashKey, `caller|${phoneNumber}`)).slice(0, 8);
}

/**
 * Generates the full actor name for a caller profile actor.
 * This is the complete HMAC hex string, used as the durable actor ID.
 *
 * @param hashKey - The secret HMAC key.
 * @param phoneNumber - The caller's phone number.
 * @returns The full HMAC hex string.
 */
export async function callerActorName(hashKey: string, phoneNumber: string): Promise<string> {
  return hmacSha256Hex(hashKey, `caller|${phoneNumber}`);
}

/**
 * Generates a short pseudonym for an employee number.
 * Returns the first 8 hex characters of an HMAC.
 *
 * @param hashKey - The secret HMAC key.
 * @param employeeNumber - The employee's number.
 * @returns A short pseudonym string.
 */
export async function employeePseudonym(hashKey: string, employeeNumber: string): Promise<string> {
  return (await hmacSha256Hex(hashKey, `emp|${employeeNumber}`)).slice(0, 8);
}

/**
 * Generates the full actor name for an employee leave actor.
 *
 * @param hashKey - The secret HMAC key.
 * @param employeeNumber - The employee's number.
 * @returns The full HMAC hex string.
 */
export async function employeeActorName(hashKey: string, employeeNumber: string): Promise<string> {
  return hmacSha256Hex(hashKey, `emp|${employeeNumber}`);
}

/**
 * Computes the stored hash of an employee PIN.
 * The PIN itself is never stored; only this HMAC is persisted.
 *
 * @param hashKey - The secret HMAC key.
 * @param employeeNumber - The employee's number.
 * @param pin - The plain-text PIN.
 * @returns The HMAC hex string of the PIN.
 */
export async function pinHash(
  hashKey: string,
  employeeNumber: string,
  pin: string,
): Promise<string> {
  return hmacSha256Hex(hashKey, `pin|${employeeNumber}|${pin}`);
}

/**
 * Computes the stored hash of a secret-question answer.
 * The plain answer is normalised (trimmed, lowercased) before hashing.
 *
 * @param hashKey - The secret HMAC key.
 * @param employeeNumber - The employee's number.
 * @param answer - The plain-text answer.
 * @returns The HMAC hex string of the answer.
 */
export async function answerHash(
  hashKey: string,
  employeeNumber: string,
  answer: string,
): Promise<string> {
  return hmacSha256Hex(hashKey, `ans|${employeeNumber}|${answer.trim().toLowerCase()}`);
}

/**
 * Generates a deterministic key for a leave request based on employee number and date range.
 * Used for idempotency: replaying the same request yields the same key.
 *
 * @param employeeNumber - The employee's number.
 * @param startDate - Leave start date (ISO).
 * @param endDate - Leave end date (ISO).
 * @returns SHA-256 hex string.
 */
export function leaveRequestKey(employeeNumber: string, startDate: string, endDate: string): Promise<string> {
  return sha256Hex(`${employeeNumber}|${startDate}|${endDate}`);
}

/**
 * Generates a deterministic key for a callback request.
 * Used for idempotency when queueing HR callbacks.
 *
 * @param phoneNumber - The caller's phone number.
 * @param reason - The callback reason.
 * @param localDate - The local date string.
 * @returns SHA-256 hex string.
 */
export function callbackRequestKey(phoneNumber: string, reason: string, localDate: string): Promise<string> {
  return sha256Hex(`${phoneNumber}|${reason}|${localDate}`);
}

/**
 * Generates a new random call reference string.
 * Format: `c_` followed by 12 hex characters (6 random bytes).
 *
 * @returns A new call reference.
 */
export function newCallRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `c_${bytesToHex(bytes)}`;
}

/**
 * Generates a new human-readable reference code.
 * Uses a custom alphabet safe for voice transcription (no 0/O or 1/I confusion).
 *
 * @param prefix - "LV" for leave requests or "CB" for callbacks.
 * @returns A reference like "LV-A3F7E2D1".
 */
export function newReference(prefix: "LV" | "CB"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(
    bytes,
    (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length] ?? "A",
  ).join("");
  return `${prefix}-${suffix}`;
}
