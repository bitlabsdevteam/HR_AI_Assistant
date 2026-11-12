import { StatefulActor } from "@telnyx/edge-runtime";

/** A single recorded call tracked for a caller. */
interface RecentCall {
  callId: string;
  returning: boolean;
}

/** Persistent state stored for each caller profile actor. */
interface CallerProfileState {
  callCount: number;
  recentCalls: RecentCall[];
  lastSeenAt: string | null;
}

/** Default empty state used when a caller profile has not been initialized. */
const EMPTY_STATE: CallerProfileState = {
  callCount: 0,
  recentCalls: [],
  lastSeenAt: null,
};

/**
 * Durable actor that tracks call history for a single caller (identified by phone number hash).
 * Used to distinguish new callers from returning callers.
 */
export class CallerProfile extends StatefulActor {
  /**
   * Records a call for this caller.
   * If the same call ID has been seen before, returns the cached result.
   * Otherwise, increments the call count and marks the caller as returning
   * if they have called at least once before.
   *
   * @param callId - Unique identifier for this call.
   * @param nowIso - Current time as an ISO-8601 string.
   * @returns Object with total call count and whether this is a returning caller.
   */
  async recordCall(
    callId: string,
    nowIso: string,
  ): Promise<{ callCount: number; returning: boolean }> {
    if (callId.length === 0 || callId.length > 160 || !Number.isFinite(Date.parse(nowIso))) {
      throw new Error("Invalid call record");
    }

    const state = (await this.ctx.storage.get<CallerProfileState>("state")) ?? {
      ...EMPTY_STATE,
      recentCalls: [],
    };

    // Idempotency: if this exact call ID was already recorded, return the previous result.
    const previous = state.recentCalls.find((call) => call.callId === callId);
    if (previous) {
      return { callCount: state.callCount, returning: previous.returning };
    }

    const returning = state.callCount > 0;
    const callCount = state.callCount + 1;
    const recentCalls = [...state.recentCalls, { callId, returning }].slice(-20);

    await this.ctx.storage.put("state", {
      callCount,
      recentCalls,
      lastSeenAt: nowIso,
    } satisfies CallerProfileState);

    return { callCount, returning };
  }

  /** Health-check endpoint for the actor. */
  async ping(): Promise<"ok"> {
    return "ok";
  }
}
