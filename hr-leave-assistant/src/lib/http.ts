/** Maximum allowed request body size in bytes (32 KiB). */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024;

/**
 * Custom error class for HTTP request problems.
 * Carries both an HTTP status code and a machine-readable error code.
 */
export class HttpRequestError extends Error {
  /**
   * @param status - HTTP status to return to the client.
   * @param code - Machine-readable code; `publicErrorMessage` turns it into the client-facing text.
   */
  constructor(
    public readonly status: 400 | 401 | 404 | 405 | 413,
    public readonly code: "invalid_input" | "unauthorized" | "not_found" | "method_not_allowed" | "body_too_large",
  ) {
    super(code);
    this.name = "HttpRequestError";
  }
}

/**
 * Reads the raw text body from a Request, enforcing a maximum byte limit.
 * Checks both the Content-Length header and the actual encoded byte length.
 *
 * @param request - The incoming HTTP request.
 * @param maximumBytes - Maximum allowed body size (defaults to 32 KiB).
 * @returns The raw body text.
 * @throws HttpRequestError with code "body_too_large" if the body exceeds the limit.
 */
export async function readRawBody(
  request: Request,
  maximumBytes = MAX_REQUEST_BODY_BYTES,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HttpRequestError(413, "body_too_large");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new HttpRequestError(413, "body_too_large");
  }
  return body;
}

/**
 * Builds a JSON Response with standard headers and optional additional headers.
 *
 * @param body - The response body (will be JSON-stringified).
 * @param status - HTTP status code (defaults to 200).
 * @param additionalHeaders - Extra headers to include.
 * @returns A Response object.
 */
export function jsonResponse(
  body: unknown,
  status = 200,
  additionalHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...additionalHeaders,
    },
  });
}

/**
 * Builds a JSON error Response from an HttpRequestError.
 *
 * @param error - The error to serialize.
 * @returns A Response with the appropriate status and error body.
 */
export function errorResponse(error: HttpRequestError): Response {
  return jsonResponse(
    { error: { code: error.code, message: publicErrorMessage(error.code) } },
    error.status,
  );
}

/**
 * Maps internal error codes to human-readable messages safe to expose to clients.
 *
 * @param code - The internal error code.
 * @returns A public-facing error message.
 */
function publicErrorMessage(code: HttpRequestError["code"]): string {
  switch (code) {
    case "invalid_input":
      return "The request body is invalid.";
    case "unauthorized":
      return "Authentication is required.";
    case "not_found":
      return "The requested route does not exist.";
    case "method_not_allowed":
      return "The HTTP method is not allowed for this route.";
    case "body_too_large":
      return "The request body is too large.";
  }
}
