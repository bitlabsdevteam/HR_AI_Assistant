import { StatefulActor } from "@telnyx/edge-runtime";
import { closedRangesOverlap } from "../domain/leave";
import { constantTimeEqual } from "../lib/auth";
import { newReference } from "../lib/identity";

/** Persistent profile data stored for each employee actor. */
export interface EmployeeProfile {
  firstName: string;
  entitlementDays: number;
  openingUsedDays: number;
  pinHash: string;
  secretQuestion: string | null;
  secretAnswerHash: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
}

/** Data required to seed (reset) an employee actor to a known state. */
export interface EmployeeResetSeed {
  firstName: string;
  entitlementDays: number;
  openingUsedDays: number;
  pinHash: string;
  secretQuestion?: string | null;
  secretAnswerHash?: string | null;
}

/** A single leave request record stored in the actor's durable state. */
export interface LeaveRequestRecord {
  reference: string;
  start: string;
  end: string;
  days: number;
  reason: string;
  status: "approved" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
  callRef: string | null;
}

/** Counter metrics maintained per employee for observability. */
export interface EmployeeCounters {
  verified: number;
  authFailures: number;
  lockouts: number;
  approved: number;
  replays: number;
  insufficient: number;
  overlaps: number;
  cancelled: number;
  cancelReplays: number;
}

/** Default counter values used when initializing or resetting an employee. */
const ZERO_COUNTERS: EmployeeCounters = {
  verified: 0,
  authFailures: 0,
  lockouts: 0,
  approved: 0,
  replays: 0,
  insufficient: 0,
  overlaps: 0,
  cancelled: 0,
  cancelReplays: 0,
};

/**
 * Durable actor that manages one employee's leave state:
 * PIN verification, balance enquiries, leave applications, and cancellations.
 *
 * All business decisions (balance checks, overlap detection, lockouts) are made
 * inside this actor. The Edge Function never trusts its own counts.
 */
export class EmployeeLeave extends StatefulActor {
  /**
   * Verifies a PIN hash against the stored hash for this employee.
   * Tracks failed attempts and enforces a 15-minute lockout after 3 failures.
   *
   * @param suppliedPinHash - The HMAC-SHA-256 of the PIN supplied by the caller.
   * @param nowIso - Current time as an ISO-8601 string.
   * @returns Result indicating success, failure with attempts remaining, or locked status.
   */
  async verifyPin(
    suppliedPinHash: string,
    nowIso: string,
  ): Promise<
    | { status: "ok"; firstName: string }
    | { status: "failed"; attemptsLeft: number }
    | { status: "locked"; minutesLeft: number }
  > {
    const nowMilliseconds = Date.parse(nowIso);
    if (!Number.isFinite(nowMilliseconds) || !/^[0-9a-f]{64}$/.test(suppliedPinHash)) {
      throw new Error("Invalid PIN verification input");
    }

    const profile = await this._requiredProfile();
    const counters = await this._counters();
    const lockedUntilMilliseconds = profile.lockedUntil
      ? Date.parse(profile.lockedUntil)
      : Number.NaN;

    // If currently locked, return remaining lock time.
    if (Number.isFinite(lockedUntilMilliseconds) && lockedUntilMilliseconds > nowMilliseconds) {
      return {
        status: "locked",
        minutesLeft: Math.max(1, Math.ceil((lockedUntilMilliseconds - nowMilliseconds) / 60_000)),
      };
    }

    // If a previous lock has expired, reset the failure count.
    if (profile.lockedUntil) {
      profile.lockedUntil = null;
      profile.failedAttempts = 0;
    }

    if (constantTimeEqual(profile.pinHash, suppliedPinHash)) {
      profile.failedAttempts = 0;
      profile.lockedUntil = null;
      counters.verified += 1;
      await Promise.all([
        this.ctx.storage.put("profile", profile),
        this.ctx.storage.put("counters", counters),
      ]);
      return { status: "ok", firstName: profile.firstName };
    }

    profile.failedAttempts += 1;
    counters.authFailures += 1;

    if (profile.failedAttempts >= 3) {
      profile.failedAttempts = 0;
      profile.lockedUntil = new Date(nowMilliseconds + 15 * 60_000).toISOString();
      counters.lockouts += 1;
      await Promise.all([
        this.ctx.storage.put("profile", profile),
        this.ctx.storage.put("counters", counters),
      ]);
      return { status: "locked", minutesLeft: 15 };
    }

    const attemptsLeft = 3 - profile.failedAttempts;
    await Promise.all([
      this.ctx.storage.put("profile", profile),
      this.ctx.storage.put("counters", counters),
    ]);
    return { status: "failed", attemptsLeft };
  }

  /**
   * Verifies a secret-answer hash against the stored hash for this employee.
   * Shares the same failed-attempt counter and 15-minute lockout as verifyPin.
   *
   * @param suppliedAnswerHash - The HMAC-SHA-256 of the normalised answer.
   * @param nowIso - Current time as an ISO-8601 string.
   * @returns Result indicating success, failure with attempts remaining, or locked status.
   */
  async verifySecretAnswer(
    suppliedAnswerHash: string,
    nowIso: string,
  ): Promise<
    | { status: "ok"; firstName: string }
    | { status: "failed"; attemptsLeft: number }
    | { status: "locked"; minutesLeft: number }
  > {
    const nowMilliseconds = Date.parse(nowIso);
    if (!Number.isFinite(nowMilliseconds) || !/^[0-9a-f]{64}$/.test(suppliedAnswerHash)) {
      throw new Error("Invalid secret answer verification input");
    }

    const profile = await this._requiredProfile();
    const counters = await this._counters();

    if (!profile.secretQuestion || !profile.secretAnswerHash) {
      // No secret question configured: behave as if verified.
      counters.verified += 1;
      await this.ctx.storage.put("counters", counters);
      return { status: "ok", firstName: profile.firstName };
    }

    const lockedUntilMilliseconds = profile.lockedUntil ? Date.parse(profile.lockedUntil) : Number.NaN;
    if (Number.isFinite(lockedUntilMilliseconds) && lockedUntilMilliseconds > nowMilliseconds) {
      return {
        status: "locked",
        minutesLeft: Math.max(1, Math.ceil((lockedUntilMilliseconds - nowMilliseconds) / 60_000)),
      };
    }

    // Expired lock: reset counts.
    if (profile.lockedUntil) {
      profile.lockedUntil = null;
      profile.failedAttempts = 0;
    }

    if (constantTimeEqual(profile.secretAnswerHash, suppliedAnswerHash)) {
      profile.failedAttempts = 0;
      profile.lockedUntil = null;
      counters.verified += 1;
      await Promise.all([
        this.ctx.storage.put("profile", profile),
        this.ctx.storage.put("counters", counters),
      ]);
      return { status: "ok", firstName: profile.firstName };
    }

    profile.failedAttempts += 1;
    counters.authFailures += 1;

    if (profile.failedAttempts >= 3) {
      profile.failedAttempts = 0;
      profile.lockedUntil = new Date(nowMilliseconds + 15 * 60_000).toISOString();
      counters.lockouts += 1;
      await Promise.all([
        this.ctx.storage.put("profile", profile),
        this.ctx.storage.put("counters", counters),
      ]);
      return { status: "locked", minutesLeft: 15 };
    }

    const attemptsLeft = 3 - profile.failedAttempts;
    await Promise.all([
      this.ctx.storage.put("profile", profile),
      this.ctx.storage.put("counters", counters),
    ]);
    return { status: "failed", attemptsLeft };
  }

  /**
   * Sets or migrates the secret question and answer hash for this employee.
   * Only writes if the fields are currently missing (lazy migration).
   *
   * @param question - The human-readable secret question.
   * @param answerHash - The HMAC-SHA-256 of the normalised answer.
   * @returns "ok" when written, "skipped" when already present.
   */
  async setSecretQuestion(question: string, answerHash: string): Promise<"ok" | "skipped"> {
    const profile = await this._requiredProfile();
    if (profile.secretQuestion && profile.secretAnswerHash) {
      return "skipped";
    }
    profile.secretQuestion = question;
    profile.secretAnswerHash = answerHash;
    await this.ctx.storage.put("profile", profile);
    return "ok";
  }

  /**
   * Returns a summary of the employee's leave balance and upcoming approved requests.
   *
   * @param todayIso - Today's date in ISO-8601 format.
   * @returns Object with first name, entitlement, used/remaining days, and upcoming requests.
   */
  async summary(todayIso: string): Promise<{
    firstName: string;
    entitlementDays: number;
    usedDays: number;
    remainingDays: number;
    upcoming: { reference: string; start: string; end: string; days: number }[];
  }> {
    const [profile, requests] = await Promise.all([
      this._requiredProfile(),
      this._requests(),
    ]);
    const usedDays = this._usedDays(profile, requests);

    return {
      firstName: profile.firstName,
      entitlementDays: profile.entitlementDays,
      usedDays,
      remainingDays: profile.entitlementDays - usedDays,
      upcoming: requests
        .filter((request) => request.status === "approved" && request.start > todayIso)
        .sort((left, right) => left.start.localeCompare(right.start))
        .map(({ reference, start, end, days }) => ({ reference, start, end, days })),
    };
  }

  /**
   * Checks whether a proposed leave request can be approved.
   * Validates balance sufficiency and overlap with existing approved requests.
   *
   * @param input - Object with start, end, and working day count.
   * @returns Success with remaining balance after approval, or failure with reason.
   */
  async check(input: { start: string; end: string; days: number }): Promise<
    | { ok: true; remainingAfter: number }
    | { ok: false; reason: "insufficient_balance" | "overlap"; remainingDays: number }
  > {
    const [profile, requests] = await Promise.all([
      this._requiredProfile(),
      this._requests(),
    ]);
    const remainingDays = profile.entitlementDays - this._usedDays(profile, requests);

    if (input.days > remainingDays) {
      return { ok: false, reason: "insufficient_balance", remainingDays };
    }

    if (this._hasOverlap(requests, input.start, input.end)) {
      return { ok: false, reason: "overlap", remainingDays };
    }

    return { ok: true, remainingAfter: remainingDays - input.days };
  }

  /**
   * Applies a leave request for this employee.
   * If the same request key has been seen before, returns the prior approval (idempotency).
   *
   * @param input - Leave details including requestKey for idempotency and callRef for tracing.
   * @returns Approval result with reference and replay flag, or failure reason.
   */
  async apply(input: {
    start: string;
    end: string;
    days: number;
    reason: string;
    requestKey: string;
    callRef: string | null;
    nowIso: string;
  }): Promise<
    | { status: "approved"; reference: string; remainingAfter: number; replayed: boolean }
    | { status: "insufficient_balance"; remainingDays: number }
    | { status: "overlap" }
  > {
    if (
      !Number.isInteger(input.days) ||
      input.days < 1 ||
      typeof input.reason !== "string" ||
      input.reason.length === 0 ||
      input.reason.length > 200 ||
      !/^[0-9a-f]{64}$/.test(input.requestKey) ||
      !Number.isFinite(Date.parse(input.nowIso))
    ) {
      throw new Error("Invalid leave application");
    }

    const storageKey = `key/${input.requestKey}`;
    const [profile, requests, counters, priorReference] = await Promise.all([
      this._requiredProfile(),
      this._requests(),
      this._counters(),
      this.ctx.storage.get<string>(storageKey),
    ]);
    const remainingDays = profile.entitlementDays - this._usedDays(profile, requests);

    // Idempotency: if this exact request was already applied, return the previous result.
    if (priorReference) {
      const priorRequest = requests.find(
        (request) => request.reference === priorReference && request.status === "approved",
      );
      if (priorRequest) {
        counters.replays += 1;
        await this.ctx.storage.put("counters", counters);
        return {
          status: "approved",
          reference: priorReference,
          remainingAfter: remainingDays,
          replayed: true,
        };
      }
    }

    if (input.days > remainingDays) {
      counters.insufficient += 1;
      await this.ctx.storage.put("counters", counters);
      return { status: "insufficient_balance", remainingDays };
    }

    if (this._hasOverlap(requests, input.start, input.end)) {
      counters.overlaps += 1;
      await this.ctx.storage.put("counters", counters);
      return { status: "overlap" };
    }

    const reference = this._uniqueLeaveReference(requests);
    const request: LeaveRequestRecord = {
      reference,
      start: input.start,
      end: input.end,
      days: input.days,
      reason: input.reason,
      status: "approved",
      createdAt: input.nowIso,
      cancelledAt: null,
      callRef: input.callRef,
    };
    counters.approved += 1;

    await Promise.all([
      this.ctx.storage.put("requests", [...requests, request]),
      this.ctx.storage.put(storageKey, reference),
      this.ctx.storage.put("counters", counters),
    ]);

    return {
      status: "approved",
      reference,
      remainingAfter: remainingDays - input.days,
      replayed: false,
    };
  }

  /**
   * Cancels an approved leave request that starts on a given date.
   * Replays are safe: cancelling the same start date again returns the prior cancellation.
   * Cannot cancel leave that has already started or passed.
   *
   * @param input - Object with startDate, todayIso, and nowIso.
   * @returns Cancellation result, not_found, or too_late.
   */
  async cancel(input: {
    startDate: string;
    todayIso: string;
    nowIso: string;
  }): Promise<
    | {
        status: "cancelled";
        reference: string;
        days: number;
        remainingAfter: number;
        replayed: boolean;
      }
    | { status: "not_found" }
    | { status: "too_late" }
  > {
    if (!Number.isFinite(Date.parse(input.nowIso))) {
      throw new Error("Invalid cancellation time");
    }

    const [profile, requests, counters] = await Promise.all([
      this._requiredProfile(),
      this._requests(),
      this._counters(),
    ]);
    const approved = requests.find(
      (request) => request.status === "approved" && request.start === input.startDate,
    );

    if (!approved) {
      // Check if this was already cancelled (idempotency / replay safety).
      const cancelled = requests
        .filter((request) => request.status === "cancelled" && request.start === input.startDate)
        .sort((left, right) =>
          (right.cancelledAt ?? "").localeCompare(left.cancelledAt ?? ""),
        )[0];
      if (!cancelled) {
        return { status: "not_found" };
      }

      counters.cancelReplays += 1;
      await this.ctx.storage.put("counters", counters);
      const remainingDays = profile.entitlementDays - this._usedDays(profile, requests);
      return {
        status: "cancelled",
        reference: cancelled.reference,
        days: cancelled.days,
        remainingAfter: remainingDays,
        replayed: true,
      };
    }

    // Cannot cancel leave that has already started.
    if (approved.start <= input.todayIso) {
      return { status: "too_late" };
    }

    approved.status = "cancelled";
    approved.cancelledAt = input.nowIso;
    counters.cancelled += 1;

    await Promise.all([
      this.ctx.storage.put("requests", requests),
      this.ctx.storage.put("counters", counters),
      this._deleteKeysForReference(approved.reference),
    ]);

    const remainingAfter = profile.entitlementDays - this._usedDays(profile, requests);
    return {
      status: "cancelled",
      reference: approved.reference,
      days: approved.days,
      remainingAfter,
      replayed: false,
    };
  }

  /** Returns all leave request records for this employee. */
  async requests(): Promise<LeaveRequestRecord[]> {
    return this._requests();
  }

  /** Returns the current counter statistics for this employee. */
  async stats(): Promise<EmployeeCounters> {
    return this._counters();
  }

  /**
   * Resets this employee actor to a clean state using the provided seed data.
   * Destroys all existing requests and counters.
   *
   * @param seed - The employee profile to seed.
   * @returns "ok" on success.
   */
  async reset(seed: EmployeeResetSeed): Promise<"ok"> {
    const profile: EmployeeProfile = {
      firstName: seed.firstName,
      entitlementDays: seed.entitlementDays,
      openingUsedDays: seed.openingUsedDays,
      pinHash: seed.pinHash,
      secretQuestion: seed.secretQuestion ?? null,
      secretAnswerHash: seed.secretAnswerHash ?? null,
      failedAttempts: 0,
      lockedUntil: null,
    };

    await this.ctx.storage.deleteAll();
    await Promise.all([
      this.ctx.storage.put("profile", profile),
      this.ctx.storage.put("requests", [] satisfies LeaveRequestRecord[]),
      this.ctx.storage.put("counters", { ...ZERO_COUNTERS }),
    ]);
    return "ok";
  }

  /** Health-check endpoint for the actor. */
  async ping(): Promise<"ok"> {
    return "ok";
  }

  /** Loads the employee profile from storage, throwing if not yet seeded. */
  private async _requiredProfile(): Promise<EmployeeProfile> {
    const profile = await this.ctx.storage.get<EmployeeProfile>("profile");
    if (!profile) {
      throw new Error("Employee has not been seeded");
    }
    return profile;
  }

  /** Loads all leave requests from storage, defaulting to an empty array. */
  private async _requests(): Promise<LeaveRequestRecord[]> {
    return (await this.ctx.storage.get<LeaveRequestRecord[]>("requests")) ?? [];
  }

  /** Loads counter metrics from storage, merging with zero defaults. */
  private async _counters(): Promise<EmployeeCounters> {
    return { ...ZERO_COUNTERS, ...(await this.ctx.storage.get<Partial<EmployeeCounters>>("counters")) };
  }

  /**
   * Computes total used leave days:
   * opening used days plus the sum of days from all currently approved requests.
   */
  private _usedDays(profile: EmployeeProfile, requests: LeaveRequestRecord[]): number {
    return (
      profile.openingUsedDays +
      requests
        .filter((request) => request.status === "approved")
        .reduce((total, request) => total + request.days, 0)
    );
  }

  /** Checks whether any approved request overlaps with the given date range. */
  private _hasOverlap(requests: LeaveRequestRecord[], start: string, end: string): boolean {
    return requests.some(
      (request) =>
        request.status === "approved" &&
        closedRangesOverlap(start, end, request.start, request.end),
    );
  }

  /**
   * Generates a unique leave reference that does not collide with existing requests.
   * Throws after 20 attempts if no unique code can be found.
   */
  private _uniqueLeaveReference(requests: LeaveRequestRecord[]): string {
    const references = new Set(requests.map((request) => request.reference));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reference = newReference("LV");
      if (!references.has(reference)) {
        return reference;
      }
    }
    throw new Error("Unable to allocate a leave reference");
  }

  /**
   * Removes all idempotency keys that point to a given leave reference.
   * Scans storage keys prefixed with "key/" in batches of 1000.
   */
  private async _deleteKeysForReference(reference: string): Promise<void> {
    let startAfter: string | undefined;

    while (true) {
      const entries = await this.ctx.storage.list<string>({
        prefix: "key/",
        limit: 1000,
        ...(startAfter ? { startAfter } : {}),
      });
      if (entries.size === 0) {
        return;
      }

      for (const [key, storedReference] of entries) {
        if (storedReference === reference) {
          await this.ctx.storage.delete(key);
        }
      }

      if (entries.size < 1000) {
        return;
      }
      startAfter = Array.from(entries.keys()).at(-1);
    }
  }
}
