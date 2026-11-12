/** Shared encoder for turning strings into bytes for comparison. */
const textEncoder = new TextEncoder();

/**
 * Compares two strings in constant time to prevent timing attacks.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

/**
 * Extracts the Bearer token from an HTTP Authorization header.
 */
export function bearerCredentials(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

/**
 * Verifies that a request carries a valid Bearer token matching the expected secret.
 */
export function hasValidBearer(request: Request, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) {
    return false;
  }

  const received = bearerCredentials(request);
  return received !== null && constantTimeEqual(received, expectedSecret);
}

/** Maximum age of a session token in seconds (15 minutes). */
const SESSION_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Creates a signed session token for a verified employee.
 * Format: `v1.<employee_number>.<expiry>.<signature>`
 * The signature is the first 32 hex chars of HMAC-SHA-256 of `tok|<employee_number>|<bind>|<expiry>`.
 */
export async function createSessionToken(input: {
  employeeNumber: string;
  hashKey: string;
  bind: string;
  nowSeconds: number;
}): Promise<string> {
  const expiry = input.nowSeconds + SESSION_TOKEN_TTL_SECONDS;
  const message = `tok|${input.employeeNumber}|${input.bind}|${expiry}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(input.hashKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  const signatureHex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `v1.${input.employeeNumber}.${expiry}.${signatureHex.slice(0, 32)}`;
}

/**
 * Verifies a session token: checks format, expiry, and HMAC signature.
 * Returns the employee number on success, or `null` if invalid/expired/forged.
 */
export async function verifySessionToken(input: {
  token: string;
  hashKey: string;
  bind: string;
  nowSeconds: number;
}): Promise<string | null> {
  const parts = input.token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return null;
  }

  const employeeNumber = parts[1]!;
  const expiry = Number(parts[2]);
  const receivedSignature = parts[3]!;

  if (!/^\d{4}$/.test(employeeNumber) || !Number.isFinite(expiry) || !/^[0-9a-f]{32}$/.test(receivedSignature)) {
    return null;
  }

  if (expiry <= input.nowSeconds) {
    return null;
  }

  const message = `tok|${employeeNumber}|${input.bind}|${expiry}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(input.hashKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSignature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(message));
  const expectedHex = Array.from(new Uint8Array(expectedSignature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32);

  if (!constantTimeEqual(receivedSignature, expectedHex)) {
    return null;
  }

  return employeeNumber;
}
