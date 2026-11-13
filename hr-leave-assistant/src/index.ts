import type { AppEnv } from "./env";
import { errorResponse, HttpRequestError, jsonResponse } from "./lib/http";
import { handleMcp } from "./mcp";
import { handleDynamicVariables } from "./webhook";
import { hasValidBearer } from "./lib/auth";
import { loadCompanyContext } from "./lib/kv";
import { DEFAULT_EMPLOYEES } from "./config/default-employees";
import { employeeActorName, pinHash, answerHash } from "./lib/identity";
import { writeCompletionLog, type LogOutcome } from "./lib/log";
import { loadLangfuseCredentials, exportSpan } from "./lib/langfuse";

// Re-export all actor classes so the runtime can instantiate them by name.
export { CallerProfile } from "./actors/caller-profile";
export { EmployeeLeave } from "./actors/employee-leave";
export { HrDesk } from "./actors/hr-desk";

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const path = new URL(request.url).pathname;

    try {
      if (path === "/health/liveness" || path === "/health/readiness") {
        if (request.method !== "GET") {
          return methodNotAllowed("GET");
        }
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (path === "/webhooks/dynamic-variables") {
        return handleDynamicVariables(request, env);
      }

      if (path === "/mcp") {
        return handleMcp(request, env);
      }

      if (path === "/ops/check") {
        return handleOpsCheck(request, env);
      }

      if (path === "/admin/requests") {
        return handleAdminRequests(request, env);
      }

      if (path === "/admin/callbacks") {
        return handleAdminCallbacks(request, env);
      }

      if (path === "/admin/stats") {
        return handleAdminStats(request, env);
      }

      if (path === "/admin/reset") {
        return handleAdminReset(request, env);
      }

      return errorResponse(new HttpRequestError(404, "not_found"));
    } catch {
      return jsonResponse(
        { error: { code: "unavailable", message: "The service is unavailable." } },
        500,
      );
    }
  },
};

function methodNotAllowed(allowed: string): Response {
  return jsonResponse(
    { error: { code: "method_not_allowed", message: "The HTTP method is not allowed for this route." } },
    405,
    { allow: allowed },
  );
}

async function requireOpsAuth(request: Request, env: AppEnv): Promise<boolean> {
  const expected = await env.SECRETS.get("OPS_TOKEN");
  return hasValidBearer(request, expected);
}

async function handleOpsCheck(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "ok";

  try {
    if (request.method !== "GET") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    if (!(await requireOpsAuth(request, env))) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const dependencies: Record<string, { ok: boolean; ms: number }> = {};

    // KV check
    const kvStarted = Date.now();
    try {
      await env.HR_KV.get("flags/leave_changes_enabled");
      dependencies.kv = { ok: true, ms: Date.now() - kvStarted };
    } catch {
      dependencies.kv = { ok: false, ms: Date.now() - kvStarted };
    }

    // HrDesk ping
    const deskStarted = Date.now();
    try {
      await env.HR_DESK.idFromName("cedar").ping();
      dependencies.hr_desk = { ok: true, ms: Date.now() - deskStarted };
    } catch {
      dependencies.hr_desk = { ok: false, ms: Date.now() - deskStarted };
    }

    // CallerProfile ping
    const callerStarted = Date.now();
    try {
      await env.CALLER_PROFILE.idFromName("ping-test").ping();
      dependencies.caller_profile = { ok: true, ms: Date.now() - callerStarted };
    } catch {
      dependencies.caller_profile = { ok: false, ms: Date.now() - callerStarted };
    }

    // EmployeeLeave ping
    const empStarted = Date.now();
    try {
      const hashKey = await env.SECRETS.get("HASH_KEY");
      if (hashKey && DEFAULT_EMPLOYEES.length > 0) {
        const firstEmployee = DEFAULT_EMPLOYEES[0]!;
        const actorName = await employeeActorName(hashKey, firstEmployee.employeeNumber);
        await env.EMPLOYEE_LEAVE.idFromName(actorName).ping();
      }
      dependencies.employee_leave = { ok: true, ms: Date.now() - empStarted };
    } catch {
      dependencies.employee_leave = { ok: false, ms: Date.now() - empStarted };
    }

    const anyFailed = Object.values(dependencies).some((d) => !d.ok);
    status = anyFailed ? 503 : 200;
    outcome = anyFailed ? "error" : "ok";

    return jsonResponse({ dependencies }, status);
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }
    status = 500;
    outcome = "error";
    return jsonResponse({ error: { code: "unavailable", message: "Ops check failed." } }, 500);
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "ops.check",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        outcome,
        duration_ms: durationMs,
      },
    });
    writeCompletionLog({
      event: "ops.completed",
      call_ref: "none",
      outcome,
      status,
      duration_ms: durationMs,
      trace,
    });
  }
}

async function handleAdminRequests(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "ok";

  try {
    if (request.method !== "GET") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    if (!(await requireOpsAuth(request, env))) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const url = new URL(request.url);
    const employeeParam = url.searchParams.get("employee");
    const hashKey = await env.SECRETS.get("HASH_KEY");

    const targets = employeeParam
      ? DEFAULT_EMPLOYEES.filter((e) => e.employeeNumber === employeeParam)
      : DEFAULT_EMPLOYEES;

    const results = await Promise.all(
      targets.map(async (emp) => {
        const actorName = hashKey ? await employeeActorName(hashKey, emp.employeeNumber) : "";
        if (!actorName) {
          return { employee_number: emp.employeeNumber, error: "missing_hash_key" };
        }
        const [requests, summary] = await Promise.all([
          env.EMPLOYEE_LEAVE.idFromName(actorName).requests(),
          env.EMPLOYEE_LEAVE.idFromName(actorName).summary("1970-01-01"),
        ]);
        return {
          employee_number: emp.employeeNumber,
          balance: {
            entitlement_days: summary.entitlementDays,
            used_days: summary.usedDays,
            remaining_days: summary.remainingDays,
          },
          requests,
        };
      }),
    );

    return jsonResponse({ employees: results });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }
    status = 500;
    outcome = "error";
    return jsonResponse({ error: { code: "unavailable", message: "Admin requests failed." } }, 500);
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "admin.requests",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        outcome,
        duration_ms: durationMs,
      },
    });
    writeCompletionLog({
      event: "admin.completed",
      call_ref: "none",
      outcome,
      status,
      duration_ms: durationMs,
      trace,
    });
  }
}

async function handleAdminCallbacks(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "ok";

  try {
    if (request.method !== "GET") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    if (!(await requireOpsAuth(request, env))) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const callbacks = await env.HR_DESK.idFromName("cedar").listCallbacks();
    return jsonResponse({ callbacks });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }
    status = 500;
    outcome = "error";
    return jsonResponse({ error: { code: "unavailable", message: "Admin callbacks failed." } }, 500);
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "admin.callbacks",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        outcome,
        duration_ms: durationMs,
      },
    });
    writeCompletionLog({
      event: "admin.completed",
      call_ref: "none",
      outcome,
      status,
      duration_ms: durationMs,
      trace,
    });
  }
}

async function handleAdminStats(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "ok";

  try {
    if (request.method !== "GET") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    if (!(await requireOpsAuth(request, env))) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const hashKey = await env.SECRETS.get("HASH_KEY");
    const employeeStats = await Promise.all(
      DEFAULT_EMPLOYEES.map(async (emp) => {
        if (!hashKey) return null;
        const actorName = await employeeActorName(hashKey, emp.employeeNumber);
        return env.EMPLOYEE_LEAVE.idFromName(actorName).stats();
      }),
    );

    const deskStats = await env.HR_DESK.idFromName("cedar").stats();

    const combined = {
      verified: 0,
      authFailures: 0,
      lockouts: 0,
      approved: 0,
      replays: 0,
      insufficient: 0,
      overlaps: 0,
      cancelled: 0,
      cancelReplays: 0,
      callbacksQueued: deskStats.callbacksQueued,
      callbackReplays: deskStats.callbackReplays,
      unknownEmployeeAttempts: deskStats.unknownEmployeeAttempts,
      unknownLockouts: deskStats.unknownLockouts,
    };

    for (const s of employeeStats) {
      if (s) {
        combined.verified += s.verified;
        combined.authFailures += s.authFailures;
        combined.lockouts += s.lockouts;
        combined.approved += s.approved;
        combined.replays += s.replays;
        combined.insufficient += s.insufficient;
        combined.overlaps += s.overlaps;
        combined.cancelled += s.cancelled;
        combined.cancelReplays += s.cancelReplays;
      }
    }

    return jsonResponse({ stats: combined });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }
    status = 500;
    outcome = "error";
    return jsonResponse({ error: { code: "unavailable", message: "Admin stats failed." } }, 500);
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "admin.stats",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        outcome,
        duration_ms: durationMs,
      },
    });
    writeCompletionLog({
      event: "admin.completed",
      call_ref: "none",
      outcome,
      status,
      duration_ms: durationMs,
      trace,
    });
  }
}

async function handleAdminReset(request: Request, env: AppEnv): Promise<Response> {
  const startedAt = Date.now();
  let status = 200;
  let outcome: LogOutcome = "ok";

  try {
    if (request.method !== "POST") {
      throw new HttpRequestError(405, "method_not_allowed");
    }

    if (!(await requireOpsAuth(request, env))) {
      status = 401;
      outcome = "unauthorized";
      return errorResponse(new HttpRequestError(401, "unauthorized"));
    }

    const hashKey = await env.SECRETS.get("HASH_KEY");
    if (!hashKey) {
      status = 500;
      outcome = "error";
      return jsonResponse({ error: { code: "unavailable", message: "HASH_KEY is not configured." } }, 500);
    }

    await Promise.all([
      ...DEFAULT_EMPLOYEES.map(async (emp) => {
        const actorName = await employeeActorName(hashKey, emp.employeeNumber);
        const pinHashValue = await pinHash(hashKey, emp.employeeNumber, emp.pin);
        const secretAnswerHash = emp.secretAnswer
          ? await answerHash(hashKey, emp.employeeNumber, emp.secretAnswer)
          : null;
        return env.EMPLOYEE_LEAVE.idFromName(actorName).reset({
          firstName: emp.firstName,
          entitlementDays: emp.entitlementDays,
          openingUsedDays: emp.openingUsedDays,
          pinHash: pinHashValue,
          secretQuestion: emp.secretQuestion,
          secretAnswerHash,
        });
      }),
      env.HR_DESK.idFromName("cedar").reset(),
    ]);

    return jsonResponse({ status: "reset" });
  } catch (error) {
    if (error instanceof HttpRequestError) {
      status = error.status;
      outcome = error.code === "unauthorized" ? "unauthorized" : "invalid_input";
      return errorResponse(error);
    }
    status = 500;
    outcome = "error";
    return jsonResponse({ error: { code: "unavailable", message: "Admin reset failed." } }, 500);
  } finally {
    const durationMs = Date.now() - startedAt;
    const credentials = await loadLangfuseCredentials(env);
    const trace = await exportSpan(credentials, {
      spanName: "admin.reset",
      startTime: startedAt,
      endTime: Date.now(),
      outcome,
      metadata: {
        outcome,
        duration_ms: durationMs,
      },
    });
    writeCompletionLog({
      event: "admin.completed",
      call_ref: "none",
      outcome,
      status,
      duration_ms: durationMs,
      trace,
    });
  }
}
