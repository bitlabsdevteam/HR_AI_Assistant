# KV session data: per-caller design

Status: **proposal, 2026-11-15. Nothing in this document is built, deployed, or tested.** It is a design for David's review. Solution code is OpenCode's (TDD §14.2); Claude wrote only this document. Platform facts cite the Telnyx wiki under `Telynyx/` and carry `evidence: stated`, meaning Telnyx's claim, not behavior observed on this account.

Related: TDD §3.1 (primitive table), §5 (dynamic-variables webhook), §9 (security floor), §10 (observability). Challenge text: `80639ad328bdbbcf732cba72559c894a/code_challenge.md` §4b.

---

## 1. Goal and why it is unmet

Challenge §4b: use Telnyx KV for at least one of *session data (caller session state across webhook calls)*, *cached responses*, or *feature flags*. PRD row 4b already claims 4b through the pause flag and the policy cache. The goal now set is the **session data** option specifically.

Today KV holds two things (`hr-leave-assistant/src/lib/kv.ts`): `profile/current` and `flags/leave_changes_enabled`. Neither is session data. Caller state across calls lives in the `CallerProfile` actor (`callCount`, `recentCalls`, `lastSeenAt`). So the session-data goal is genuinely unmet.

Earlier sessions kept finding the goal unmet and a Stop hook blocked turn end 9 times. No Stop hook exists in `~/.claude/settings.json` or the repository; the loop came from a goal check whose "done" was never checkable. §9 below makes it checkable.

## 2. Two readings, and why per-call is blocked

| | Per-caller (chosen) | Per-call |
| --- | --- | --- |
| Meaning | State about who is calling, kept across separate phone calls | State about this one conversation, shared by the webhook and the MCP tools |
| Key | HMAC of the caller's phone number | Conversation ID (or `call_ref`) |
| Written by | Webhook, end of each call | Webhook, once at call start |
| Read by | Webhook, start of the next call | MCP handler, on every tool call |
| Join problem | None: the webhook has the phone number on both write and read | The webhook must hold the key the tools read with |
| Status | Buildable | Blocked |

Why per-call is blocked:

- The documented `assistant.initialization` payload carries `call_control_id`, `assistant_id`, `telnyx_end_user_target`, and no `telnyx_conversation_id` (`Telynyx/raw/assets/telnyx-docs/docs/inference/ai-assistants/dynamic-variables.md`, payload example). `webhook.ts` treats the field as optional.
- MCP tool calls do carry `conversation_id`. Live logs (`telnyx-edge logs`, 72 h, 2026-11-15) show it on 10 of the 102 `webhook.completed` / `tool.completed` lines, covering N10, N30, N35, N40, N50, N70 and discovery. They carry no phone number and no `call_control_id`.
- So no key exists that both paths hold, unless Telnyx sends the conversation ID on the webhook anyway. That is open check C-2.
- Keying on `call_ref` does not help: reading it back needs the model to pass `call_ref` to the tool, and if it does, the server already has it.

Revisit per-call only after one real call shows the webhook payload's key names (names only, never values).

Note for reviewers: `tests/log.test.ts` (webhook payload fixture) includes `telnyx_conversation_id`, which Telnyx's documented payload lacks. The fixture is ahead of the platform and hides C-2.

## 3. Design

One KV record per caller. It is a **hint**, never an input to a decision.

| Item | Value |
| --- | --- |
| Key | `session/caller/<callerActorName(hashKey, phone)>`: the existing `caller\|` HMAC (`src/lib/identity.ts`), 64 hex characters. No colon (KV rejects colons), well under the 256-character key limit. No new `HASH_KEY` prefix. |
| Value | JSON, zod-validated: `{ v: 1, last_call_at, last_call_ref, last_call_id_hash, last_outcome }`. `last_outcome` is `"ready"` or `"degraded"`. `last_call_id_hash` is the first 16 hex characters of SHA-256 of `call_control_id`. |
| Never stored | Phone number, employee number, name, PIN, session token, or anything a decision reads. |
| TTL | `expirationTtl: 86400` (24 h). Needs `@telnyx/edge-runtime` 0.2.2 or later; the project pins 0.16.1. |
| Read | At call start, in parallel with `loadCompanyContext` and `resolveCallerStatus`, under its own deadline. |
| Write | Once, after the response is computed, as a **blind overwrite**: the new value never depends on the value read. Own short deadline. A failed or late write is logged and ignored. |
| Consumer | New dynamic variable `recent_caller`: `"true"` when the previous call was within 30 minutes, else `"false"`. Text only, read by N00 or N01. No new edge. |

### 3.1 Why KV and not the actor

`CallerProfile` already stores `lastSeenAt`, so a reviewer will ask why this is not read from the actor. The honest answer:

- The actor owns the exact, race-safe call count and `returning` flag. TDD §3.1 keeps it there because KV has no compare-and-set. **That does not change.**
- The KV record is a separate, expiring, last-write-wins hint about the previous call (its reference, time, and outcome). A stale or lost write costs nothing because no decision reads it.
- KV is used here because the goal asks for KV session data. The strongest argument against this design is that `CallerProfile.recordCall` could return `lastSeenAt` and drive `recent_caller` with no KV at all. If David judges that more pragmatic, the goal should be met with a different KV use instead of this one.

### 3.2 Behavior rules

- **No phone number or no `HASH_KEY`:** the webhook does not call the session code and logs `session: "skipped"`.
- **Read result:** `hit`, `missing` (key absent, value malformed, unknown `v`, or the stored `last_call_id_hash` equals the current call's), `error` (KV threw or deadline hit). Only `hit` can produce `recent_caller: "true"`.
- **Webhook retry:** if Telnyx re-posts the same init event, the retry would read the record the first attempt just wrote and report a first-time caller as recent. The call-ID hash comparison above prevents that, in the same way `CallerProfile.recordCall` de-duplicates on call ID.
- **Overlapping calls from one number:** the second reads before the first writes, sees a miss, and gets `"false"`. Last write wins afterward. Harmless.
- **Failure never degrades the call.** A session read or write failure leaves `context_status: "ready"`. Only the existing failures (invalid payload, thrown error after signature check) produce `degraded`.
- **Degraded response** returns `recent_caller: "false"`.

### 3.3 Timing budget

The webhook awaits the Langfuse export in `finally` before returning (`webhook.ts`, `OTLP_TIMEOUT_MS` = 300 ms; Langfuse secrets are bound in `telnyx.toml`), so that export is on the response's critical path. The assistant waits `dynamic_variables_webhook_timeout_ms` (Portal, set to 3000). If the webhook is late, Telnyx falls back to the assistant defaults, `context_status` becomes `"degraded"`, and a healthy call is routed to N90.

| Step | Deadline |
| --- | --- |
| KV profile and flag, `CallerProfile`, session read (parallel) | 1500 ms (today 2000 ms; tighten) |
| Session write | 300 ms |
| Langfuse export | 300 ms (existing) |
| Worst case | 2100 ms, leaving about 900 ms for network and runtime overhead |

The baseline is already high: a trivial MCP `initialize` logged 586 to 629 ms on 2026-11-14. Cold start (check C-5) is unmeasured for the webhook. The wiki execution-model page shows no `waitUntil` or post-response work, so the write cannot be moved off the critical path (`Telynyx/wiki/telnyx/edge-compute/edge-compute-runtime-execution-model.md`).

## 4. Platform facts relied on

All from the wiki, `evidence: stated`:

- Keys allow `a-z A-Z 0-9 - _ / = .`; colons are rejected; 256-character limit. TTL by `expirationTtl`, whole seconds.
- Concurrent writers to one key are last-write-wins, with no transactions or compare-and-swap.
- Read-your-writes is reliable from one location. Across locations a read after a write elsewhere may briefly see the old value. At the minute scale of a 30-minute window this only produces a `missing`, which falls back safely.
- A missing key reads as `null`; non-404 failures throw.

Sources: `edge-compute-kv-overview-and-concepts`, `edge-compute-kv-runtime-api`, `edge-compute-kv-examples-and-ttl` (all under `Telynyx/wiki/telnyx/edge-compute/`).

## 5. Impact on the current code and design

**Code touched (webhook path only).** `src/webhook.ts`: one parallel read, one write, one new variable, the degraded response. `src/lib/log.ts`: one optional `session` field and detail values. New `src/lib/session.ts`.

**Not touched.** `src/env.ts` (the `HR_KV` binding already has `put` with `expirationTtl`), `telnyx.toml` (same namespace, no new binding or secret), `src/index.ts`, `mcp.ts`, `tools.ts`, the three actors, the session token, `HASH_KEY` prefixes. The MCP path and every security-floor rule on it are unchanged.

**Document deltas (to be made only after this file is approved).**

| File | Change |
| --- | --- |
| `docs/TDD.md` §3.1 | New row for the per-caller hint, with the §3.1 reason above. The "Deliberately not in KV" sentence stays. |
| `docs/TDD.md` §5 | Variable table goes from eight to nine; add `recent_caller` to the table and to the assistant-side defaults (`"false"`). Reword "No name, count, or history is ever spoken" for `caller_status`, because `recent_caller` speaks a fragment of history. |
| `docs/TDD.md` §9 | Name the 24 h KV copy of the caller pseudonym. `CallerProfile` already keeps the same pseudonym indefinitely, so retention does not get worse. |
| `docs/TDD.md` §10.1 | `session: hit \| missing \| error \| skipped`, plus detail values for a failed write. |
| `docs/GRADING_MAP.md` "Pragmatic KV" | Say: config, flag, and a last-write-wins session hint; never a decision. |
| `docs/PRD.md` row 4b | Add the session hint. This is outside PRD §3.1 Must, since 4b is already met by the flag and policy. |
| `AGENTS.md` | Invariant: the KV session record is a hint; never store identity, tokens, or anything a decision reads; the write is a blind overwrite whose value never depends on what was read. |
| `docs/DEVLOG.md` | The 2026-11-14 webhook review says the response has exactly eight variables and plans a key-set test; both become nine. Add a review line when the slice lands. |

**Voice wording.** The record knows only that a webhook answered about 30 minutes ago, not that the call dropped. Use "Welcome back, I see you called a moment ago", never "sorry we got cut off".

**Existing tests.** The webhook tests in `tests/log.test.ts` mock `HR_KV.get` to return `null`, so a second read returns `null` and they keep passing; they assert exactly one log line, which the design preserves. The test where `HASH_KEY` throws after signature verification still lands in the degraded path because the session code runs inside the same `try`. New tests are additive.

**What stays true.** One log line per request. No PIN, token, employee number, or raw phone in KV or logs. `session` stays off the Langfuse allowlist (`src/lib/langfuse.ts`). Actors decide every leave outcome.

## 6. Security floor check (TDD §9)

- Item 6: the key is a 64-hex HMAC, the value holds no raw phone number, employee number, PIN, name, or token. The log carries only the `session` state word. The key and the record are never logged.
- Item 3: no employee data and no identity decision depends on the record. Caller ID still never identifies an employee.
- Item 9: `session` is not added to the Langfuse span metadata allowlist.
- Retention: 24 h TTL. A caller who withholds the number gets `skipped` and no record.

## 7. Slice spec for OpenCode

Hand this to OpenCode as one slice. Claude reviews the commit afterwards.

1. **`src/lib/session.ts` (new).**
   - `callerSessionKey(hashKey, phone)`, using `callerActorName`, prefixed `session/caller/`.
   - `loadCallerSession(env, key, callIdHash)` returns `{ session, state: "hit" | "missing" | "error" }`. Validates with zod. Never throws.
   - `saveCallerSession(env, key, record)` using `put(..., { expirationTtl: 86400 })`. Never throws.
   - Pure `isRecentCaller(session, now)` with a 30-minute window.
2. **`src/webhook.ts`.**
   - Read in parallel with the existing two promises; shared read deadline 1500 ms.
   - Add `recent_caller` to the happy response.
   - Write after the response is built, with a 300 ms deadline. A write failure must not change `context_status`.
   - `degradedVariablesResponse` returns `recent_caller: "false"`.
   - Optional, separate commit: the same function returns `leave_changes_enabled: "true"` where TDD §5 sets `"false"` (the open non-blocking finding in the 2026-11-14 DEVLOG review).
3. **`src/lib/log.ts`.** Add `session` and the detail values. Never log the key or the record.
4. **Tests** (`tests/session.test.ts`, extend `tests/log.test.ts`).
   - Hit, miss, error, malformed JSON, unknown `v`.
   - Same-call-ID record counts as `missing` (retry case).
   - KV `put` rejects and the response is still `ready`; `put` exceeds 300 ms and the response is still `ready`.
   - Recent-window boundary at exactly 30 minutes.
   - Key has no colon and is at most 256 characters.
   - Leak test: the phone number, the key, and the value appear in no log line.
   - Happy response has exactly nine keys, all strings; the degraded response values are asserted.
5. **Portal (David, manual).** Add default `recent_caller = "false"` and one prompt sentence in N00 or N01. The default is required: on a webhook timeout an unset variable would be spoken raw.

## 8. Failure modes

| Failure | What happens | Evidence |
| --- | --- | --- |
| KV read errors or times out | `recent_caller: "false"`, call proceeds, `outcome: "ready"` | log `session: "error"` |
| Key absent, expired, or malformed | Same | log `session: "missing"` |
| KV write fails or is late | Ignored, call proceeds | log detail for the failed write |
| No phone number, or no `HASH_KEY` | No read, no write | log `session: "skipped"` |
| Webhook slow past the assistant timeout | Telnyx uses assistant defaults, call goes to N90 | no `webhook.completed` for that call, or a long `duration_ms` |

## 9. Acceptance

**Local, no approval needed.**
- `npm run typecheck` clean.
- `npm test` green, with the tests in §7 added to the current 106.
- A diff review confirms the §6 floor.

**Deploy-gated.** Each step needs David's explicit go-ahead; `ship` and phone calls spend credit.

0. **Blocking prerequisite.** David confirms in the Portal that the assistant's dynamic-variables webhook URL is the deployed `/webhooks/dynamic-variables`, and that `dynamic_variables_webhook_timeout_ms` is 3000. The 72 h log pull is complete (`has_more: false`) and contains real voice tool calls on 2026-11-14 but no `webhook.completed` line, so the webhook may not be wired. If it is not, no later step can pass.
1. `telnyx-edge deployments hr-leave-assistant` to confirm the active revision (the last DEVLOG entry left `db1e1073382a` pending).
2. `ship`, then two real calls from one number within 30 minutes.
3. `telnyx-edge storage kv key list 1b0b0a50-c921-498d-9916-ec3f085da147 --prefix session/` shows one key. `kv key get` shows the JSON with no personal data.
4. Call 2's `webhook.completed` line shows `session: "hit"` and the assistant says the recent-caller line.
5. Fallback proof: `kv key delete` the key and call again. The line shows `session: "missing"` and `outcome: "ready"`, and the call works. A call with no number logs `session: "skipped"`.
6. Record the lines in `docs/DEVLOG.md`. These are also the first observed `webhook.completed` lines on this account (C-3 and C-5 evidence). C-2 remains open until the webhook payload's key names are seen.

## 10. Open questions for David

1. Is the per-caller reading the one the goal means? (Chosen on 2026-11-15; per-call stays blocked on C-2.)
2. Accept the wording change to TDD §5, "No name, count, or history is ever spoken"?
3. Keep the 30-minute window and 24 h TTL, or change them?
4. Fold the `leave_changes_enabled` degraded-default fix into the same slice, or keep it a separate commit?
