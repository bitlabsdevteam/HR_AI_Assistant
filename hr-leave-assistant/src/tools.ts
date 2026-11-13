import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DEFAULT_EMPLOYEES } from "./config/default-employees";
import type { PolicyTopic } from "./config/default-profile";
import { policyAnswer, policyTopicSchema } from "./domain/profile";
import { spokenIsoDate, todayIsoInTimeZone } from "./domain/time";
import { validateLeaveDates, workingDaysInclusive } from "./domain/leave";
import type { AppEnv } from "./env";
import { createSessionToken, verifySessionToken } from "./lib/auth";
import { loadCompanyContext, loadCompanyProfile } from "./lib/kv";
import { employeeActorName, employeePseudonym, leaveRequestKey, newReference, pinHash, callbackRequestKey, answerHash } from "./lib/identity";
import { createVerificationToken, verifyVerificationToken } from "./lib/verification-token";

/** Zod schema for get_leave_policy tool input. */
const getLeavePolicyInputSchema = z.object({ topic: policyTopicSchema }).strict();

/** Zod schema for verify_employee tool input. */
const verifyEmployeeInputSchema = z.object({
  employee_number: z.string().regex(/^\d{4}$/),
  pin: z.string().regex(/^\d{4}$/),
}).strict();

/** Zod schema for answer_secret_question tool input. */
const answerSecretQuestionInputSchema = z.object({
  verification_token: z.string().min(1).max(200),
  answer: z.string().min(1).max(100),
}).strict();

/** Zod schema for get_leave_balance tool input. */
const getLeaveBalanceInputSchema = z.object({
  auth_token: z.string().min(1).max(100),
}).strict();

/** Zod schema for preview_leave tool input. */
const previewLeaveInputSchema = z.object({
  auth_token: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

/** Zod schema for apply_leave tool input. */
const applyLeaveInputSchema = z.object({
  auth_token: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  call_ref: z.string().regex(/^c_[0-9a-f]{12}$/).optional(),
}).strict();

/** Zod schema for cancel_leave tool input. */
const cancelLeaveInputSchema = z.object({
  auth_token: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  call_ref: z.string().regex(/^c_[0-9a-f]{12}$/).optional(),
}).strict();

/** Zod schema for request_hr_callback tool input. */
const requestHrCallbackInputSchema = z.object({
  caller_name: z.string().min(1).max(80),
  callback_number: z.string().min(1).max(32),
  reason: z.enum(["leave_balance", "leave_request", "verification", "other"]),
  note: z.string().min(1).max(200).optional(),
  call_ref: z.string().regex(/^c_[0-9a-f]{12}$/).optional(),
}).strict();

/** Observation object shared between the MCP handler and tool implementations. */
export interface McpObservation {
  kv?: "hit" | "fallback";
  emp?: string;
  actor_ms?: number;
  call_ref?: string;
}

/** Builds a success tool result with structured content. */
function toolSuccess<T>(text: string, data: T): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: { ok: true as const, data },
  };
}

/** Builds an error tool result with structured content. */
function toolError(code: string, message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false as const, code, message },
    isError: true,
  };
}

/**
 * Wraps an actor call so its wall-clock time is added to observation.actor_ms.
 */
async function withActorTiming<T>(
  observation: McpObservation,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    observation.actor_ms = (observation.actor_ms ?? 0) + (Date.now() - start);
  }
}

/**
 * Verifies the session token from an MCP tool call and returns the employee number.
 * Also enriches observation with KV status.
 */
async function resolveEmployeeFromToken(
  env: AppEnv,
  token: string,
  conversationId: string | undefined,
  observation: McpObservation,
): Promise<{ employeeNumber: string; empPseudonym: string } | null> {
  const hashKey = await env.SECRETS.get("HASH_KEY");
  if (!hashKey) {
    return null;
  }

  const bind = conversationId ?? "none";
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const employeeNumber = await verifySessionToken({ token, hashKey, bind, nowSeconds });
  if (!employeeNumber) {
    return null;
  }

  const empPseudonym = await employeePseudonym(hashKey, employeeNumber);
  observation.emp = empPseudonym;
  return { employeeNumber, empPseudonym };
}

/**
 * Handler for verify_employee tool. Exported for testing.
 */
export async function handleVerifyEmployee(
  env: AppEnv,
  observation: McpObservation,
  conversationId: string | undefined,
  args: { employee_number: string; pin: string },
): Promise<CallToolResult> {
  const { employee_number, pin } = args;
  const hashKey = await env.SECRETS.get("HASH_KEY");
  if (!hashKey) {
    return toolError("unavailable", "Sign-in is unavailable right now. Please ask for an HR callback.");
  }

  observation.emp = await employeePseudonym(hashKey, employee_number);

  const employee = DEFAULT_EMPLOYEES.find((e) => e.employeeNumber === employee_number);
  const suppliedPinHash = await pinHash(hashKey, employee_number, pin);
  const nowIso = new Date().toISOString();

  if (!employee) {
    const empHash = await employeeActorName(hashKey, employee_number);
    const result = await withActorTiming(observation, () =>
      env.HR_DESK.idFromName("cedar").failUnknown(empHash, nowIso),
    );
    if (result.status === "locked") {
      return toolError("locked", `That didn't match. Your account is locked for ${result.minutesLeft} minutes. I can arrange an HR callback.`);
    }
    return toolError("auth_failed", `That didn't match. You have ${result.attemptsLeft} tries left.`);
  }

  const actorName = await employeeActorName(hashKey, employee_number);
  const result = await withActorTiming(observation, () =>
    env.EMPLOYEE_LEAVE.idFromName(actorName).verifyPin(suppliedPinHash, nowIso),
  );

  if (result.status === "locked") {
    return toolError("locked", `That didn't match. Your account is locked for ${result.minutesLeft} minutes. I can arrange an HR callback.`);
  }

  if (result.status === "failed") {
    return toolError("auth_failed", `That didn't match. You have ${result.attemptsLeft} tries left.`);
  }

  if (employee.secretQuestion) {
    const verificationToken = await createVerificationToken({
      employeeNumber: employee.employeeNumber,
      hashKey,
      conversationId: conversationId ?? "none",
      nowSeconds: Math.floor(Date.now() / 1_000),
    });
    return toolSuccess(
      `For extra security, please answer your secret question: ${employee.secretQuestion}`,
      { needs_secret_question: true as const, question: employee.secretQuestion, verification_token: verificationToken },
    );
  }

  const token = await createSessionToken({
    employeeNumber: employee.employeeNumber,
    hashKey,
    bind: "none",
    nowSeconds: Math.floor(Date.now() / 1_000),
  });

  return toolSuccess(
    `Welcome, ${result.firstName}.`,
    { auth_token: token, first_name: result.firstName },
  );
}

/**
 * Handler for answer_secret_question tool. Exported for testing.
 */
export async function handleAnswerSecretQuestion(
  env: AppEnv,
  observation: McpObservation,
  conversationId: string | undefined,
  args: { verification_token: string; answer: string },
): Promise<CallToolResult> {
  const { verification_token, answer } = args;
  const hashKey = await env.SECRETS.get("HASH_KEY");
  if (!hashKey) {
    return toolError("unavailable", "Sign-in is unavailable right now. Please ask for an HR callback.");
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const bind = conversationId ?? "none";
  const employeeNumber = await verifyVerificationToken({
    token: verification_token,
    hashKey,
    conversationId: bind,
    nowSeconds,
  });

  if (!employeeNumber) {
    return toolError("unauthenticated", "Your verification session has expired. Please sign in again with your employee number and PIN.");
  }

  observation.emp = await employeePseudonym(hashKey, employeeNumber);
  const suppliedAnswerHash = await answerHash(hashKey, employeeNumber, answer);
  const nowIso = new Date().toISOString();
  const actorName = await employeeActorName(hashKey, employeeNumber);
  const result = await withActorTiming(observation, () =>
    env.EMPLOYEE_LEAVE.idFromName(actorName).verifySecretAnswer(suppliedAnswerHash, nowIso),
  );

  if (result.status === "locked") {
    return toolError("locked", `That didn't match. Your account is locked for ${result.minutesLeft} minutes. I can arrange an HR callback.`);
  }

  if (result.status === "failed") {
    return toolError("auth_failed", `That didn't match. You have ${result.attemptsLeft} tries left.`);
  }

  const token = await createSessionToken({
    employeeNumber,
    hashKey,
    bind: "none",
    nowSeconds: Math.floor(Date.now() / 1_000),
  });

  return toolSuccess(
    `Welcome, ${result.firstName}.`,
    { auth_token: token, first_name: result.firstName },
  );
}

/**
 * Creates and configures the HR Leave MCP server.
 *
 * Registers all seven tools for the Telnyx AI Assistant.
 */
export function createHrLeaveMcpServer(env: AppEnv, observation: McpObservation, conversationId?: string): McpServer {
  const server = new McpServer({
    name: "hr-leave-assistant",
    version: "0.1.0",
  });

  // Tool: get_leave_policy
  server.registerTool(
    "get_leave_policy",
    {
      title: "Get leave policy",
      description:
        "Use this tool to answer an employee's general leave-policy or HR-hours question without signing in. Choose the single topic that best matches the question.",
      inputSchema: getLeavePolicyInputSchema,
    },
    async ({ topic }): Promise<CallToolResult> => {
      try {
        const { profile, kv } = await loadCompanyProfile(env);
        observation.kv = kv;
        const typedTopic = topic as PolicyTopic;
        const answer = policyAnswer(profile, typedTopic);
        return toolSuccess(answer, { topic: typedTopic, answer });
      } catch {
        return toolError(
          "unavailable",
          "Leave policy is unavailable right now. Please ask for an HR callback.",
        );
      }
    },
  );

  // Tool: verify_employee
  server.registerTool(
    "verify_employee",
    {
      title: "Verify employee",
      description:
        "Verify an employee by their four-digit employee number and four-digit PIN. If the employee has no secret question, returns an auth_token. If they do, returns a verification_token and asks the secret question next. This is the only tool that takes an employee number.",
      inputSchema: verifyEmployeeInputSchema,
    },
    async ({ employee_number, pin }): Promise<CallToolResult> =>
      handleVerifyEmployee(env, observation, conversationId, { employee_number, pin }),
  );

  // Tool: answer_secret_question
  server.registerTool(
    "answer_secret_question",
    {
      title: "Answer secret question",
      description:
        "Answer the secret question after verifying a PIN. Requires the verification_token from verify_employee and the answer text.",
      inputSchema: answerSecretQuestionInputSchema,
    },
    async ({ verification_token, answer }): Promise<CallToolResult> =>
      handleAnswerSecretQuestion(env, observation, conversationId, { verification_token, answer }),
  );

  // Tool: get_leave_balance
  server.registerTool(
    "get_leave_balance",
    {
      title: "Get leave balance",
      description: "Get the signed-in employee's annual leave balance and upcoming approved leave. Requires an auth_token.",
      inputSchema: getLeaveBalanceInputSchema,
    },
    async ({ auth_token }): Promise<CallToolResult> => {
      const resolved = await resolveEmployeeFromToken(env, auth_token, undefined, observation);
      if (!resolved) {
        return toolError("unauthenticated", "Please sign in first with your employee number and PIN.");
      }

      const { employeeNumber, empPseudonym } = resolved;
      const hashKey = await env.SECRETS.get("HASH_KEY");
      if (!hashKey) {
        return toolError("unavailable", "Leave balance is unavailable right now. Please ask for an HR callback.");
      }

      const now = new Date();
      const { profile } = await loadCompanyProfile(env);
      const todayIso = todayIsoInTimeZone(now, profile.timezone);
      const actorName = await employeeActorName(hashKey, employeeNumber);
      const summary = await withActorTiming(observation, () =>
        env.EMPLOYEE_LEAVE.idFromName(actorName).summary(todayIso),
      );

      const upcomingText = summary.upcoming.length > 0
        ? ` Upcoming approved leave: ${summary.upcoming.map((u) => `${spokenIsoDate(u.start)} to ${spokenIsoDate(u.end)}, ${u.days} working days`).join("; ")}.`
        : "";

      return toolSuccess(
        `You have ${summary.remainingDays} days remaining out of ${summary.entitlementDays} days annual leave.${upcomingText}`,
        {
          entitlement_days: summary.entitlementDays,
          used_days: summary.usedDays,
          remaining_days: summary.remainingDays,
          upcoming: summary.upcoming,
        },
      );
    },
  );

  // Tool: preview_leave
  server.registerTool(
    "preview_leave",
    {
      title: "Preview leave",
      description: "Preview how many working days a leave request would use and whether it fits the policy and balance. Requires an auth_token.",
      inputSchema: previewLeaveInputSchema,
    },
    async ({ auth_token, start_date, end_date }): Promise<CallToolResult> => {
      const resolved = await resolveEmployeeFromToken(env, auth_token, undefined, observation);
      if (!resolved) {
        return toolError("unauthenticated", "Please sign in first with your employee number and PIN.");
      }

      const { employeeNumber } = resolved;
      const { profile, leaveChangesEnabled, kv } = await loadCompanyContext(env);
      observation.kv = kv;

      if (!leaveChangesEnabled) {
        return toolError("changes_paused", "Leave requests and cancellations are paused right now. I can take your details for an HR callback.");
      }

      const now = new Date();
      const todayIso = todayIsoInTimeZone(now, profile.timezone);

      const validation = validateLeaveDates({
        startDate: start_date,
        endDate: end_date,
        todayIso,
        profile,
      });

      if (!validation.ok) {
        return toolError(validation.code, validation.message);
      }

      const hashKey = await env.SECRETS.get("HASH_KEY");
      if (!hashKey) {
        return toolError("unavailable", "Unable to check your balance right now. Please ask for an HR callback.");
      }

      const actorName = await employeeActorName(hashKey, employeeNumber);
      const actorCheck = await withActorTiming(observation, () =>
        env.EMPLOYEE_LEAVE.idFromName(actorName).check({
          start: start_date,
          end: end_date,
          days: validation.workingDays,
        }),
      );

      if (!actorCheck.ok) {
        return toolError(
          actorCheck.reason,
          actorCheck.reason === "insufficient_balance"
            ? `That would use ${validation.workingDays} working days, but you only have ${actorCheck.remainingDays} days remaining.`
            : `That overlaps with existing approved leave.`,
        );
      }

      return toolSuccess(
        `From ${spokenIsoDate(start_date)} to ${spokenIsoDate(end_date)} is ${validation.workingDays} working days. After approval you would have ${actorCheck.remainingAfter} days remaining.`,
        {
          working_days: validation.workingDays,
          remaining_after: actorCheck.remainingAfter,
        },
      );
    },
  );

  // Tool: apply_leave
  server.registerTool(
    "apply_leave",
    {
      title: "Apply for leave",
      description: "Apply for annual leave. Requires an auth_token, start date, and end date. The system counts working days and checks policy, overlap, and balance. Reads back dates before confirming.",
      inputSchema: applyLeaveInputSchema,
    },
    async ({ auth_token, start_date, end_date, call_ref }): Promise<CallToolResult> => {
      const resolved = await resolveEmployeeFromToken(env, auth_token, undefined, observation);
      if (!resolved) {
        return toolError("unauthenticated", "Please sign in first with your employee number and PIN.");
      }

      observation.call_ref = call_ref ?? undefined;

      const { employeeNumber } = resolved;
      const { profile, leaveChangesEnabled, kv } = await loadCompanyContext(env);
      observation.kv = kv;

      if (!leaveChangesEnabled) {
        return toolError("changes_paused", "Leave requests and cancellations are paused right now. I can take your details for an HR callback.");
      }

      const now = new Date();
      const todayIso = todayIsoInTimeZone(now, profile.timezone);

      const validation = validateLeaveDates({
        startDate: start_date,
        endDate: end_date,
        todayIso,
        profile,
      });

      if (!validation.ok) {
        return toolError(validation.code, validation.message);
      }

      const hashKey = await env.SECRETS.get("HASH_KEY");
      if (!hashKey) {
        return toolError("unavailable", "Unable to apply for leave right now. Please ask for an HR callback.");
      }

      const requestKey = await leaveRequestKey(employeeNumber, start_date, end_date);
      const actorName = await employeeActorName(hashKey, employeeNumber);
      const result = await withActorTiming(observation, () =>
        env.EMPLOYEE_LEAVE.idFromName(actorName).apply({
          start: start_date,
          end: end_date,
          days: validation.workingDays,
          requestKey,
          callRef: call_ref ?? null,
          nowIso: now.toISOString(),
        }),
      );

      if (result.status === "insufficient_balance") {
        return toolError(
          "insufficient_balance",
          `That would use ${validation.workingDays} working days, but you only have ${result.remainingDays} days remaining.`,
        );
      }

      if (result.status === "overlap") {
        return toolError("overlap", "That overlaps with existing approved leave.");
      }

      const replayText = result.replayed ? " That was already approved." : "";
      return toolSuccess(
        `Approved. Your reference is ${result.reference}. You now have ${result.remainingAfter} days remaining.${replayText}`,
        {
          status: "approved",
          reference: result.reference,
          working_days: validation.workingDays,
          remaining_after: result.remainingAfter,
        },
      );
    },
  );

  // Tool: cancel_leave
  server.registerTool(
    "cancel_leave",
    {
      title: "Cancel leave",
      description: "Cancel approved leave that has not started yet. Requires an auth_token and the start date of the leave to cancel.",
      inputSchema: cancelLeaveInputSchema,
    },
    async ({ auth_token, start_date, call_ref }): Promise<CallToolResult> => {
      const resolved = await resolveEmployeeFromToken(env, auth_token, undefined, observation);
      if (!resolved) {
        return toolError("unauthenticated", "Please sign in first with your employee number and PIN.");
      }

      observation.call_ref = call_ref ?? undefined;

      const { employeeNumber } = resolved;
      const { profile, leaveChangesEnabled, kv } = await loadCompanyContext(env);
      observation.kv = kv;

      if (!leaveChangesEnabled) {
        return toolError("changes_paused", "Leave requests and cancellations are paused right now. I can take your details for an HR callback.");
      }

      const now = new Date();
      const todayIso = todayIsoInTimeZone(now, profile.timezone);
      const hashKey = await env.SECRETS.get("HASH_KEY");
      if (!hashKey) {
        return toolError("unavailable", "Unable to cancel leave right now. Please ask for an HR callback.");
      }

      const actorName = await employeeActorName(hashKey, employeeNumber);
      const result = await withActorTiming(observation, () =>
        env.EMPLOYEE_LEAVE.idFromName(actorName).cancel({
          startDate: start_date,
          todayIso,
          nowIso: now.toISOString(),
        }),
      );

      if (result.status === "not_found") {
        return toolError("not_found", "I couldn't find approved leave starting on that date.");
      }

      if (result.status === "too_late") {
        return toolError("out_of_policy", "That leave has already started and cannot be cancelled.");
      }

      const replayText = result.replayed ? " That was already cancelled." : "";
      return toolSuccess(
        `Cancelled. ${result.days} working days restored. You now have ${result.remainingAfter} days remaining.${replayText}`,
        {
          status: "cancelled",
          reference: result.reference,
          working_days_restored: result.days,
          remaining_after: result.remainingAfter,
        },
      );
    },
  );

  // Tool: request_hr_callback
  server.registerTool(
    "request_hr_callback",
    {
      title: "Request HR callback",
      description: "Request a callback from the HR team. Does not require sign-in. Collects name, callback number, and reason.",
      inputSchema: requestHrCallbackInputSchema,
    },
    async ({ caller_name, callback_number, reason, note, call_ref }): Promise<CallToolResult> => {
      observation.call_ref = call_ref ?? undefined;

      const { profile } = await loadCompanyProfile(env);
      const now = new Date();
      const todayIso = todayIsoInTimeZone(now, profile.timezone);
      const callbackKey = await callbackRequestKey(callback_number, reason, todayIso);

      const result = await withActorTiming(observation, () =>
        env.HR_DESK.idFromName("cedar").addCallback({
          name: caller_name,
          phone: callback_number,
          reason,
          note: note ?? null,
          callRef: call_ref ?? null,
          callbackKey,
          nowIso: now.toISOString(),
        }),
      );

      const replayText = result.replayed ? " That request was already queued." : "";
      return toolSuccess(
        `Your callback has been queued. Reference ${result.reference}.${replayText}`,
        { status: "queued", reference: result.reference },
      );
    },
  );

  return server;
}
