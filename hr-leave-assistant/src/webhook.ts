import { z } from "zod";
import { DEFAULT_PROFILE } from "./config/default-profile";
import { isOpenNow, todayIsoInTimeZone, todaySpokenInTimeZone } from "./domain/time";
import type { AppEnv } from "./env";
import { callerActorName, callerPseudonym, newCallRef } from "./lib/identity";
import { errorResponse, HttpRequestError, jsonResponse, readRawBody } from "./lib/http";
import { loadCompanyContext } from "./lib/kv";
import { writeCompletionLog, type CompletionLog, type LogOutcome } from "./lib/log";
import { loadLangfuseCredentials, exportSpan } from "./lib/langfuse";
import { verifyTelnyxWebhookSignature } from "./lib/signature";

/** Maximum time to wait for KV and actor calls during webhook processing (2 seconds). */
const WEBHOOK_DEADLINE_MS = 2_000;

/** Zod schema for the Telnyx assistant initialization webhook payload. */
const initializationEventSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(160),
    event_type: z.literal("assistant.initialization"),
    payload: z.object({
      telnyx_end_user_target: z.string().min(1).max(32).optional(),
      call_control_id: z.string().min(1).max(160).optional(),
      telnyx_conversation_id: z.string().min(1).max(200).optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

/**
 * Handles the Telnyx AI Assistant dynamic-variables webhook.
 *
 * This endpoint is called at the start of every phone call. It:
 * 1. Validates the webhook signature.
 * 2. Parses the initialization event.
 * 3. Loads company context from KV (with fallback to defaults).
 * 4. Resolves the caller's status (new / returning / unknown) via the CallerProfile actor.
 * 5. Returns dynamic variables that populate the assistant's conversation workflow.
 *
 * Every path through this function writes exactly one structured log line.
 *
 * @param request - The incoming webhook request.
 * @param env - The application environment.
 * @returns A JSON Response containing dynamic variables.
 */
export async function handleDynamicVariables(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "error";
  let callRef = "none";
  let caller: string | undefined;
  let actorMilliseconds: number | undefined;
  let kv: "hit" | "missing" | "error" | undefined;
  let detail: CompletionLog["detail"];
  let signatureVerified = false;
  let conversationId: string | undefined;

  try {
    if (request.method !== "POST") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    const rawBody = await readRawBody(request);
    const publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
    const validSignature =
      publicKey !== undefined &&
      (await verifyTelnyxWebhookSignature({ rawBody, headers: request.headers, publicKey }));

    if (!validSignature) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    signatureVerified = true;
    callRef = newCallRef();

    let event: z.infer<typeof initializationEventSchema>;
    try {
      event = initializationEventSchema.parse(JSON.parse(rawBody));
    } catch {
      outcome = "invalid_input";
      detail = "invalid_payload";
      return degradedVariablesResponse(callRef);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const phoneNumber = event.data.payload.telnyx_end_user_target;
    const callId = event.data.payload.call_control_id ?? event.data.id;
    conversationId = event.data.payload.telnyx_conversation_id;
    const hashKey = await env.SECRETS.get("HASH_KEY");

    // Load company context and caller status in parallel, each with a deadline.
    const contextPromise = withDeadline(loadCompanyContext(env), WEBHOOK_DEADLINE_MS);
    const callerPromise = withDeadline(
      resolveCallerStatus(env, {
        phoneNumber,
        callId,
        nowIso,
        hashKey,
        onPseudonym: (pseudonym) => {
          caller = pseudonym;
        },
        onActorMilliseconds: (milliseconds) => {
          actorMilliseconds = milliseconds;
        },
      }),
      WEBHOOK_DEADLINE_MS,
    );

    const [contextResult, callerResult] = await Promise.allSettled([
      contextPromise,
      callerPromise,
    ]);

    const context =
      contextResult.status === "fulfilled"
        ? contextResult.value
        : { profile: DEFAULT_PROFILE, leaveChangesEnabled: true, kv: "error" as const };
    kv = context.kv;
    if (context.kv === "missing") {
      detail = "kv_missing";
    } else if (context.kv === "error") {
      detail = "kv_error";
    }

    let callerStatus: "new" | "returning" | "unknown" = "unknown";
    if (callerResult.status === "fulfilled") {
      callerStatus = callerResult.value.callerStatus;
      if (callerResult.value.detail) {
        detail = callerResult.value.detail;
      }
    } else {
      detail = "actor_unavailable";
    }

    outcome = "ready";
    return jsonResponse({
      dynamic_variables: {
        company_name: context.profile.companyName,
        today_iso: todayIsoInTimeZone(now, context.profile.timezone),
        today_spoken: todaySpokenInTimeZone(now, context.profile.timezone),
        is_open_now: String(isOpenNow(now, context.profile)),
        leave_changes_enabled: String(context.leaveChangesEnabled),
        caller_status: callerStatus,
        context_status: "ready",
        call_ref: callRef,
      },
    });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized"
        ? "unauthorized"
        : error.code === "method_not_allowed"
          ? "method_not_allowed"
          : "invalid_input";
      return errorResponse(error);
    }

    if (signatureVerified) {
      status = 200;
      outcome = "degraded";
      return degradedVariablesResponse(callRef);
    }

    status = 500;
    outcome = "error";
    return jsonResponse(
      { error: { code: "unavailable", message: "Call context is unavailable." } },
      500,
    );
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "webhook.dynamic-variables",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        call_ref: callRef,
        conversation_id: conversationId,
        node: "initialization",
        outcome,
        duration_ms: durationMs,
        caller,
      },
    });
    writeCompletionLog({
      event: "webhook.completed",
      call_ref: callRef,
      caller,
      conversation_id: conversationId,
      node: "initialization",
      outcome,
      status,
      duration_ms: durationMs,
      actor_ms: actorMilliseconds,
      kv,
      detail,
      trace,
    });
  }
}

/**
 * Resolves whether a caller is new, returning, or unknown.
 * Looks up (or creates) the CallerProfile actor for the phone number.
 *
 * @param env - The application environment.
 * @param input - Object with phone number, call ID, timestamps, and callbacks for pseudonym and timing.
 * @returns The caller's status and optional detail.
 */
async function resolveCallerStatus(
  env: AppEnv,
  input: {
    phoneNumber?: string;
    callId: string;
    nowIso: string;
    hashKey?: string;
    onPseudonym: (pseudonym: string) => void;
    onActorMilliseconds: (milliseconds: number) => void;
  },
): Promise<{
  callerStatus: "new" | "returning" | "unknown";
  detail?: CompletionLog["detail"];
}> {
  if (!input.phoneNumber) {
    return { callerStatus: "unknown" };
  }
  if (!input.hashKey) {
    return { callerStatus: "unknown", detail: "missing_hash_key" };
  }

  const [pseudonym, actorName] = await Promise.all([
    callerPseudonym(input.hashKey, input.phoneNumber),
    callerActorName(input.hashKey, input.phoneNumber),
  ]);
  input.onPseudonym(pseudonym);

  const startedAt = Date.now();
  try {
    const record = await env.CALLER_PROFILE.idFromName(actorName).recordCall(
      input.callId,
      input.nowIso,
    );
    return { callerStatus: record.returning ? "returning" : "new" };
  } finally {
    input.onActorMilliseconds(Date.now() - startedAt);
  }
}

/**
 * Wraps a promise with a deadline. Rejects with an Error if the operation
 * does not complete within the specified milliseconds.
 *
 * @param operation - The promise to race.
 * @param deadlineMs - Maximum time to wait.
 * @returns The resolved value of the operation.
 * @throws Error "Deadline exceeded" if the timeout wins.
 */
async function withDeadline<T>(operation: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Deadline exceeded")), deadlineMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Returns a degraded dynamic-variables response using the bundled default profile.
 * Used when the webhook payload is invalid or a critical dependency times out.
 *
 * @param callRef - The call reference to include in the response.
 * @returns A JSON Response with default context values.
 */
function degradedVariablesResponse(callRef: string): Response {
  const now = new Date();
  return jsonResponse({
    dynamic_variables: {
      company_name: DEFAULT_PROFILE.companyName,
      today_iso: todayIsoInTimeZone(now, DEFAULT_PROFILE.timezone),
      today_spoken: todaySpokenInTimeZone(now, DEFAULT_PROFILE.timezone),
      is_open_now: String(isOpenNow(now, DEFAULT_PROFILE)),
      leave_changes_enabled: "true",
      caller_status: "unknown",
      context_status: "degraded",
      call_ref: callRef,
    },
  });
}
