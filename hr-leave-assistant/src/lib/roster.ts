import { z } from "zod";
import type { AppEnv, SqlDatabaseBinding } from "../env";
import { resolveTeradb } from "../env";
import { withDeadline } from "./deadline";

/** Maximum time to wait for a roster SQL query (1 second). */
const ROSTER_DEADLINE_MS = 1_000;

/** Zod schema for a row from the Employee table. */
const employeeRowSchema = z.object({
  employee_number: z.string().min(1),
  first_name: z.string().min(1),
  entitlement_days: z.number().int().min(0),
  pin_hash: z.string().min(1),
  secret_question: z.string().nullable(),
  secret_answer_hash: z.string().nullable(),
  active: z.number().int(),
});

/** Employee identity as read from the SQL roster. */
export interface RosterEmployee {
  employeeNumber: string;
  firstName: string;
  entitlementDays: number;
  pinHash: string;
  secretQuestion: string | null;
  secretAnswerHash: string | null;
}

/** Result of looking up an employee in the roster. */
export type FindEmployeeResult =
  | { state: "hit"; employee: RosterEmployee }
  | { state: "missing" }
  | { state: "error" };

/**
 * Looks up an active employee in the SQL roster.
 *
 * @param env - The application environment.
 * @param employeeNumber - The employee number to look up.
 * @returns hit with the employee, missing, or error.
 */
export async function findEmployee(
  env: AppEnv,
  employeeNumber: string,
): Promise<FindEmployeeResult> {
  const db = resolveTeradb(env);
  if (!db) {
    return { state: "error" };
  }

  try {
    const row = await withDeadline(
      db
        .prepare(
          "SELECT employee_number, first_name, entitlement_days, pin_hash, secret_question, secret_answer_hash, active FROM Employee WHERE employee_number = ?",
        )
        .bind(employeeNumber)
        .first<Record<string, unknown>>(),
      ROSTER_DEADLINE_MS,
    );

    if (!row) {
      return { state: "missing" };
    }

    const parsed = employeeRowSchema.safeParse(row);
    if (!parsed.success) {
      return { state: "missing" };
    }

    const data = parsed.data;
    if (data.active !== 1) {
      return { state: "missing" };
    }

    return {
      state: "hit",
      employee: {
        employeeNumber: data.employee_number,
        firstName: data.first_name,
        entitlementDays: data.entitlement_days,
        pinHash: data.pin_hash,
        secretQuestion: data.secret_question,
        secretAnswerHash: data.secret_answer_hash,
      },
    };
  } catch {
    return { state: "error" };
  }
}

/**
 * Lists all active employee numbers from the SQL roster.
 *
 * @param env - The application environment.
 * @returns An array of employee numbers, or error if SQL fails.
 */
export async function listActiveEmployeeNumbers(
  env: AppEnv,
): Promise<{ state: "ok"; numbers: string[] } | { state: "error" }> {
  const db = resolveTeradb(env);
  if (!db) {
    return { state: "error" };
  }

  try {
    const { results } = await withDeadline(
      db
        .prepare("SELECT employee_number FROM Employee WHERE active = 1")
        .all<{ employee_number: string }>(),
      ROSTER_DEADLINE_MS,
    );

    return {
      state: "ok",
      numbers: results.map((r) => r.employee_number),
    };
  } catch {
    return { state: "error" };
  }
}

/**
 * Lists all active employees from the SQL roster with full identity fields.
 *
 * @param env - The application environment.
 * @returns An array of employees, or error if SQL fails.
 */
export async function listActiveEmployees(
  env: AppEnv,
): Promise<{ state: "ok"; employees: RosterEmployee[] } | { state: "error" }> {
  const db = resolveTeradb(env);
  if (!db) {
    return { state: "error" };
  }

  try {
    const { results } = await withDeadline(
      db
        .prepare(
          "SELECT employee_number, first_name, entitlement_days, pin_hash, secret_question, secret_answer_hash, active FROM Employee WHERE active = 1",
        )
        .all<Record<string, unknown>>(),
      ROSTER_DEADLINE_MS,
    );

    const employees: RosterEmployee[] = [];
    for (const row of results) {
      const parsed = employeeRowSchema.safeParse(row);
      if (parsed.success) {
        const data = parsed.data;
        employees.push({
          employeeNumber: data.employee_number,
          firstName: data.first_name,
          entitlementDays: data.entitlement_days,
          pinHash: data.pin_hash,
          secretQuestion: data.secret_question,
          secretAnswerHash: data.secret_answer_hash,
        });
      }
    }

    return { state: "ok", employees };
  } catch {
    return { state: "error" };
  }
}
