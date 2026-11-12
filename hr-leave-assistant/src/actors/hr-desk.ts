import { StatefulActor } from "@telnyx/edge-runtime";
import { newReference } from "../lib/identity";

/** A single callback request stored in the HR desk actor. */
export interface CallbackRecord {
  name: string;
  phone: string;
  reason: string;
  note: string | null;
  callRef: string | null;
  createdAt: string;
}

/** Counter metrics maintained by the HR desk actor. */
export interface HrDeskCounters {
  callbacksQueued: number;
  callbackReplays: number;
  unknownEmployeeAttempts: number;
  unknownLockouts: number;
}

/** Internal state tracking failed attempts for unknown employee numbers. */
interface UnknownEmployeeState {
  failedAttempts: number;
  lockedUntil: string | null;
  updatedAt: string;
}

/** Default counter values used when resetting the HR desk. */
const ZERO_COUNTERS: HrDeskCounters = {
  callbacksQueued: 0,
  callbackReplays: 0,
  unknownEmployeeAttempts: 0,
  unknownLockouts: 0,
};

/**
 * Durable actor that manages the HR desk state:
 * callback queueing, unknown-employee lockouts, and desk-level counters.
 */
export class HrDesk extends StatefulActor {
  /**
   * Queues a new HR callback request.
   * If the same callback key was used before, returns the previous reference (idempotency).
   *
   * @param input - Callback details including name, phone, reason, and a hash key for deduplication.
   * @returns The callback reference and whether it was a replay.
   */
  async addCallback(input: {
    name: string;
    phone: string;
    reason: string;
    note: string | null;
    callRef: string | null;
    callbackKey: string;
    nowIso: string;
  }): Promise<{ reference: string; replayed: boolean }> {
    if (!/^[0-9a-f]{64}$/.test(input.callbackKey) || !Number.isFinite(Date.parse(input.nowIso))) {
      throw new Error("Invalid callback input");
    }

    const replayKey = `callbackkey/${input.callbackKey}`;
    const [previousReference, counters] = await Promise.all([
      this.ctx.storage.get<string>(replayKey),
      this._counters(),
    ]);

    // Replay detection: return the existing callback if the same key was seen.
    if (previousReference) {
      const previous = await this.ctx.storage.get<CallbackRecord>(
        `callback/${previousReference}`,
      );
      if (previous) {
        counters.callbackReplays += 1;
        await this.ctx.storage.put("counters", counters);
        return { reference: previousReference, replayed: true };
      }
    }

    const reference = await this._uniqueCallbackReference();
    const record: CallbackRecord = {
      name: input.name,
      phone: input.phone,
      reason: input.reason,
      note: input.note,
      callRef: input.callRef,
      createdAt: input.nowIso,
    };
    counters.callbacksQueued += 1;

    await Promise.all([
      this.ctx.storage.put(`callback/${reference}`, record),
      this.ctx.storage.put(replayKey, reference),
      this.ctx.storage.put("counters", counters),
    ]);

    return { reference, replayed: false };
  }

  /**
   * Records a failed authentication attempt for an unknown employee number.
   * After 3 failures, locks the number for 15 minutes.
   * This ensures that guessing unknown numbers is indistinguishable from wrong PINs.
   *
   * @param employeeHash - The hash of the employee number (used as the storage key).
   * @param nowIso - Current time as an ISO-8601 string.
   * @returns Failed status with attempts remaining, or locked status with minutes left.
   */
  async failUnknown(
    employeeHash: string,
    nowIso: string,
  ): Promise<
    { status: "failed"; attemptsLeft: number } | { status: "locked"; minutesLeft: number }
  > {
    const nowMilliseconds = Date.parse(nowIso);
    if (!/^[0-9a-f]{64}$/.test(employeeHash) || !Number.isFinite(nowMilliseconds)) {
      throw new Error("Invalid unknown-employee attempt");
    }

    const storageKey = `unknown/${employeeHash}`;
    const [stored, counters] = await Promise.all([
      this.ctx.storage.get<UnknownEmployeeState>(storageKey),
      this._counters(),
    ]);
    const state = stored ?? { failedAttempts: 0, lockedUntil: null, updatedAt: nowIso };
    const lockedUntilMilliseconds = state.lockedUntil
      ? Date.parse(state.lockedUntil)
      : Number.NaN;

    // If currently locked, return remaining lock time.
    if (Number.isFinite(lockedUntilMilliseconds) && lockedUntilMilliseconds > nowMilliseconds) {
      return {
        status: "locked",
        minutesLeft: Math.max(1, Math.ceil((lockedUntilMilliseconds - nowMilliseconds) / 60_000)),
      };
    }

    // If a previous lock has expired, reset the failure count.
    if (state.lockedUntil) {
      state.lockedUntil = null;
      state.failedAttempts = 0;
    }

    state.failedAttempts += 1;
    state.updatedAt = nowIso;
    counters.unknownEmployeeAttempts += 1;

    let result:
      | { status: "failed"; attemptsLeft: number }
      | { status: "locked"; minutesLeft: number };

    if (state.failedAttempts >= 3) {
      state.failedAttempts = 0;
      state.lockedUntil = new Date(nowMilliseconds + 15 * 60_000).toISOString();
      counters.unknownLockouts += 1;
      result = { status: "locked", minutesLeft: 15 };
    } else {
      result = { status: "failed", attemptsLeft: 3 - state.failedAttempts };
    }

    // Prune old unknown-employee records if this is a new entry and storage is growing.
    if (!stored) {
      await this._pruneUnknownEmployees();
    }
    await Promise.all([
      this.ctx.storage.put(storageKey, state),
      this.ctx.storage.put("counters", counters),
    ]);
    return result;
  }

  /**
   * Lists all queued callbacks, sorted by creation time (newest first).
   *
   * @returns Array of callback records enriched with their reference strings.
   */
  async listCallbacks(): Promise<(CallbackRecord & { reference: string })[]> {
    const callbacks: (CallbackRecord & { reference: string })[] = [];
    let startAfter: string | undefined;

    while (true) {
      const entries = await this.ctx.storage.list<CallbackRecord>({
        prefix: "callback/",
        limit: 1000,
        ...(startAfter ? { startAfter } : {}),
      });
      for (const [key, callback] of entries) {
        callbacks.push({ ...callback, reference: key.slice("callback/".length) });
      }

      if (entries.size < 1000) {
        break;
      }
      const lastKey = Array.from(entries.keys()).at(-1);
      if (!lastKey) {
        break;
      }
      startAfter = lastKey;
    }

    return callbacks.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Returns the current counter statistics for the HR desk. */
  async stats(): Promise<HrDeskCounters> {
    return this._counters();
  }

  /** Resets the HR desk actor to a clean state, preserving only zeroed counters. */
  async reset(): Promise<"ok"> {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put("counters", { ...ZERO_COUNTERS });
    return "ok";
  }

  /** Health-check endpoint for the actor. */
  async ping(): Promise<"ok"> {
    return "ok";
  }

  /** Loads counter metrics from storage, merging with zero defaults. */
  private async _counters(): Promise<HrDeskCounters> {
    return { ...ZERO_COUNTERS, ...(await this.ctx.storage.get<Partial<HrDeskCounters>>("counters")) };
  }

  /**
   * Generates a unique callback reference that does not collide with existing callbacks.
   * Throws after 20 attempts if no unique code can be found.
   */
  private async _uniqueCallbackReference(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const reference = newReference("CB");
      if (!(await this.ctx.storage.get<CallbackRecord>(`callback/${reference}`))) {
        return reference;
      }
    }
    throw new Error("Unable to allocate a callback reference");
  }

  /**
   * Prunes old unknown-employee lockout records when storage grows past 500 entries.
   * Keeps the 499 most recently updated records and removes the rest.
   */
  private async _pruneUnknownEmployees(): Promise<void> {
    const entries = await this.ctx.storage.list<UnknownEmployeeState>({
      prefix: "unknown/",
      limit: 1000,
    });
    if (entries.size < 500) {
      return;
    }

    const oldestFirst = Array.from(entries).sort(([, left], [, right]) =>
      left.updatedAt.localeCompare(right.updatedAt),
    );
    const numberToRemove = entries.size - 499;
    await Promise.all(
      oldestFirst.slice(0, numberToRemove).map(([key]) => this.ctx.storage.delete(key)),
    );
  }
}
