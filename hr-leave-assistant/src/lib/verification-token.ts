const textEncoder = new TextEncoder();

/** Maximum age of a verification token in seconds (2 minutes). */
const VERIFICATION_TOKEN_TTL_SECONDS = 2 * 60;

/**
 * Creates a short-lived signed verification token that bridges the PIN step
 * and the secret-answer step.
 *
 * Format: `temp1.<employee_number>.<conversation_id>.<expiry>.<signature>`
 * Signature is the first 32 hex chars of HMAC-SHA-256 of
 * `vtemp|<employee_number>|<conversation_id>|<expiry>`.
 */
export async function createVerificationToken(input: {
  employeeNumber: string;
  hashKey: string;
  conversationId: string;
  nowSeconds: number;
}): Promise<string> {
  const expiry = input.nowSeconds + VERIFICATION_TOKEN_TTL_SECONDS;
  const message = `vtemp|${input.employeeNumber}|${input.conversationId}|${expiry}`;
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
  return `temp1.${input.employeeNumber}.${input.conversationId}.${expiry}.${signatureHex.slice(0, 32)}`;
}

/**
 * Verifies a verification token: checks format, expiry, conversation binding,
 * and HMAC signature.
 *
 * Returns the employee number on success, or `null` if invalid/expired/forged.
 */
export async function verifyVerificationToken(input: {
  token: string;
  hashKey: string;
  conversationId: string;
  nowSeconds: number;
}): Promise<string | null> {
  const parts = input.token.split(".");
  if (parts.length !== 5 || parts[0] !== "temp1") {
    return null;
  }

  const employeeNumber = parts[1];
  const tokenConversationId = parts[2];
  const expiry = Number(parts[3]);
  const receivedSignature = parts[4];

  if (
    !employeeNumber ||
    !tokenConversationId ||
    !Number.isFinite(expiry) ||
    !receivedSignature ||
    !/^[0-9a-f]{32}$/.test(receivedSignature)
  ) {
    return null;
  }

  if (expiry <= input.nowSeconds) {
    return null;
  }

  if (tokenConversationId !== input.conversationId) {
    return null;
  }

  const message = `vtemp|${employeeNumber}|${tokenConversationId}|${expiry}`;
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

  if (receivedSignature !== expectedHex) {
    return null;
  }

  return employeeNumber;
}
