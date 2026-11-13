import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppEnv } from "./env";
import { hasValidBearer } from "./lib/auth";
import { errorResponse, HttpRequestError, jsonResponse, readRawBody } from "./lib/http";
import { writeCompletionLog, type CompletionLog, type LogOutcome } from "./lib/log";
import { loadLangfuseCredentials, exportSpan } from "./lib/langfuse";
import { createHrLeaveMcpServer, type McpObservation } from "./tools";

/** Metadata extracted from an incoming MCP request for logging and routing. */
interface RequestMetadata {
  methodName: string;
  toolName: string;
  conversationId?: string;
  detail?: CompletionLog["detail"];
}

/**
 * Handles incoming MCP (Model Context Protocol) HTTP requests.
 *
 * Authenticates via Bearer token, parses the JSON-RPC envelope, routes the request
 * through the MCP server, and logs the outcome. Every path writes exactly one
 * structured log line in `finally`.
 *
 * @param request - The incoming MCP request.
 * @param env - The application environment.
 * @returns The MCP response.
 */
export async function handleMcp(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  const observation: McpObservation = {};
  let status = 500;
  let outcome: LogOutcome = "error";
  let metadata: RequestMetadata = { methodName: "unknown", toolName: "unknown" };

  try {
    if (request.method !== "POST") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    const expectedBearer = await env.SECRETS.get("MCP_BEARER");
    if (!hasValidBearer(request, expectedBearer)) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const rawBody = await readRawBody(request);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new HttpRequestError(400, "invalid_input");
    }
    metadata = extractRequestMetadata(parsedBody);

    const server = createHrLeaveMcpServer(env, observation, metadata.conversationId);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);

    const response = await transport.handleRequest(request, { parsedBody });
    status = response.status;
    outcome = await outcomeFromMcpResponse(response);
    return response;
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }

    status = 500;
    outcome = "error";
    return jsonResponse(
      { error: { code: "unavailable", message: "The MCP service is unavailable." } },
      500,
    );
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: metadata.toolName,
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        call_ref: observation.call_ref ?? "none",
        conversation_id: metadata.conversationId,
        tool: metadata.methodName === "tools/call" ? metadata.toolName : metadata.methodName,
        node: metadata.methodName === "tools/call" ? nodeForTool(metadata.toolName) : "discovery",
        outcome,
        duration_ms: durationMs,
        actor_ms: observation.actor_ms,
        emp: observation.emp,
        kv: observation.kv,
      },
    });
    writeCompletionLog({
      event: "tool.completed",
      call_ref: observation.call_ref ?? "none",
      conversation_id: metadata.conversationId,
      node: metadata.methodName === "tools/call" ? nodeForTool(metadata.toolName) : "discovery",
      tool: metadata.methodName === "tools/call" ? metadata.toolName : metadata.methodName,
      outcome,
      status,
      duration_ms: durationMs,
      actor_ms: observation.actor_ms,
      emp: observation.emp,
      kv: observation.kv,
      detail: metadata.detail,
      trace,
    });
  }
}

/**
 * Extracts metadata (method name, tool name, conversation ID) from a JSON-RPC request body.
 * Validates formats and records missing/invalid conversation IDs as detail for logging.
 *
 * @param body - Parsed JSON body of the MCP request.
 * @returns Structured metadata for the request.
 */
function extractRequestMetadata(body: unknown): RequestMetadata {
  const envelope = asRecord(body);
  const methodCandidate = envelope?.method;
  const methodName =
    typeof methodCandidate === "string" && /^[a-z/_]{1,64}$/.test(methodCandidate)
      ? methodCandidate
      : "unknown";
  const params = asRecord(envelope?.params);
  const nameCandidate = params?.name;
  const toolName =
    typeof nameCandidate === "string" && /^[a-z_]{1,64}$/.test(nameCandidate)
      ? nameCandidate
      : "unknown";
  const meta = asRecord(params?._meta);
  const conversation = meta?.telnyx_conversation_id;

  let conversationId: string | undefined;
  let detail: CompletionLog["detail"];
  if (typeof conversation === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(conversation)) {
    conversationId = conversation;
  } else if (methodName === "tools/call") {
    detail = conversation === undefined ? "missing_conversation_id" : "invalid_conversation_id";
  }

  return { methodName, toolName, conversationId, detail };
}

/**
 * Derives a LogOutcome from an MCP HTTP response by inspecting the JSON-RPC body.
 * Maps JSON-RPC errors and tool structured-content codes to the project's outcome vocabulary.
 *
 * @param response - The HTTP Response returned by the MCP transport.
 * @returns The mapped LogOutcome.
 */
async function outcomeFromMcpResponse(response: Response): Promise<LogOutcome> {
  if (!response.ok) {
    return "error";
  }

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return "ok";
  }

  const envelope = asRecord(payload);
  if (envelope?.error) {
    const rpcError = asRecord(envelope.error);
    return typeof rpcError?.code === "number" && [-32700, -32600, -32601, -32602].includes(rpcError.code)
      ? "invalid_input"
      : "error";
  }

  const result = asRecord(envelope?.result);
  const structured = asRecord(result?.structuredContent);

  if (structured?.ok === false) {
    const code = structured?.code;
    return code === "invalid_input" ||
      code === "unauthenticated" ||
      code === "auth_failed" ||
      code === "locked" ||
      code === "out_of_policy" ||
      code === "insufficient_balance" ||
      code === "overlap" ||
      code === "changes_paused" ||
      code === "not_found"
      ? code
      : "error";
  }

  if (structured?.ok === true) {
    const data = asRecord(structured?.data);
    if (typeof data?.status === "string" && isToolOutcome(data.status)) {
      return data.status as LogOutcome;
    }
    if (typeof data?.auth_token === "string") {
      return "verified";
    }
    if (data?.needs_secret_question === true) {
      return "needs_secret_question";
    }
  }

  return "ok";
}

/**
 * Checks whether a string is a known tool-level outcome.
 */
function isToolOutcome(value: string): value is LogOutcome {
  return [
    "ready",
    "degraded",
    "ok",
    "verified",
    "needs_secret_question",
    "auth_failed",
    "locked",
    "approved",
    "cancelled",
    "replayed",
    "insufficient_balance",
    "overlap",
    "out_of_policy",
    "not_found",
    "changes_paused",
    "queued",
    "invalid_input",
    "unauthenticated",
    "unauthorized",
    "error",
  ].includes(value);
}

/**
 * Maps an MCP tool name to the workflow node name used in logs.
 *
 * @param toolName - The name of the MCP tool.
 * @returns The corresponding node identifier.
 */
function nodeForTool(toolName: string): string {
  switch (toolName) {
    case "verify_employee":
    case "answer_secret_question":
    case "get_leave_balance":
      return "N10";
    case "preview_leave":
      return "N30";
    case "apply_leave":
      return "N35";
    case "cancel_leave":
      return "N40";
    case "get_leave_policy":
      return "N50";
    case "request_hr_callback":
      return "N70";
    default:
      return "MCP";
  }
}

/**
 * Safely casts an unknown value to a plain object record.
 *
 * @param value - Any value.
 * @returns The value as a Record, or `null` if it is not a plain object.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
