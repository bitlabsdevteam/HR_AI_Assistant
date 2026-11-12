# Review fix list for OpenCode: `hr-leave-assistant/src` (2026-11-12)

From: Claude Code (reviewer). To: OpenCode (builder), through David. Scope: all 19 files in `hr-leave-assistant/src/`. They are untracked, so there is no commit to cite.

How to use this list:

- Fix one item per commit and name the item (F1, F2, ...) in the message.
- Record each fix in `docs/DEVLOG.md` with your model ID.
- Before touching anything on the Telnyx platform, read `Telynyx/index.md` as `AGENTS.md` says. Do not edit the wiki.
- `npm run typecheck` and `npm test` could not run during the review because `node_modules` is not installed. Run `npm install` first, report the real output, and fix anything they show before starting.
- Line numbers are from 2026-11-12 17:05 JST. Files were still being edited at that time, so check the line before you change it.

## Blocking

### F1. The PIN lockout logic is copied into two actors
- **Where:** `src/actors/employee-leave.ts:125-134` and `src/actors/hr-desk.ts:152-159`.
- **What breaks:** AGENTS requires an unknown employee number to behave exactly like a wrong PIN (same countdown, same lock). That only holds while two copies of "3 failures, 15 minutes, `attempts_left` = 3 - n" stay identical. A change to one copy makes an unknown number distinguishable from a real one, and that reveals which employee numbers exist.
- **Fix:** put the state machine in a pure `src/domain/lockout.ts`. Time comes in as an argument and it imports nothing from `@telnyx/edge-runtime`. Suggested shape: `recordFailure(state, nowMs) -> { state, result }` and `checkLock(state, nowMs)`. The constants `MAX_ATTEMPTS = 3` and `LOCK_MINUTES = 15` live there once. Both actors call it.
- **Done when:** `tests/lockout.test.ts` shows 3 failures give `attemptsLeft` 2, 1, then locked for 15 minutes. It also shows a locked state stays locked, an expired lock resets the count, and a success clears the count. Both actors import the module and neither holds the constants.

### F2. Routes `/ops/check` and `/admin/*` do not exist
- **Where:** `src/index.ts:33-41` routes only health, `/webhooks/dynamic-variables` and `/mcp`. `OPS_TOKEN` is bound (`src/env.ts:8`, `telnyx.toml`) and never read.
- **What breaks:** nothing can seed the demo employees, so every `EmployeeLeave` call throws "Employee has not been seeded". Nothing can read the counters or the callback queue either.
- **Fix:** implement the routes in TDD §4.2 (`docs/TDD.md` lines 187-191): `GET /ops/check`, `GET /admin/requests`, `GET /admin/callbacks`, `GET /admin/stats` and `POST /admin/reset`.
  - Use `hasValidBearer` with `OPS_TOKEN`. A missing secret returns 401.
  - `reset` seeds each `DEFAULT_EMPLOYEES` entry through `EmployeeLeave.reset` with `pinHash(...)`, and calls `HrDesk.reset`.
  - Each request writes one log line in `finally`, with event `ops.completed` or `admin.completed`, and carries no PIN, employee number or phone number.
  - Return a pseudonym or the roster-derived label, never a raw PIN.
- **Done when:** `scripts/smoke.sh` calls `/ops/check` with and without the token (200 and 401) and `/admin/reset` returns the seeded roster. The log line appears in `telnyx-edge logs`.

### F3. The remaining six MCP tools are not built
- **Where:** `src/tools.ts` registers only `get_leave_policy`. The challenge needs 3 or more tools, and TDD §7.2 lists seven.
- **Note:** this is a slice dependency, not a bug, if the current slice is only the policy tool. Check `docs/PRD.md` §9 for the order. Do not build them all in one commit.
- **Fix:** add the tools in slice order from TDD §7.1 and §7.2: `verify_employee` first with the signed session token, then `get_leave_balance`, `apply_leave`, `cancel_leave`, and the rest listed there. Only `verify_employee` accepts an employee number. Every other tool checks the token first, and a bad one returns `unauthenticated`.
- **Done when:** each tool has a happy-path test and a fallback test (wrong PIN, insufficient balance, overlap, too-late cancel). `tools/list` shows the tool names. Update `nodeForTool` in `src/mcp.ts:178` with each new tool's node (see F10).

## High

### F4. Un-awaited handler returns bypass the safety `try/catch`
- **Where:** `src/index.ts:34` and `src/index.ts:38`: `return handleDynamicVariables(...)` and `return handleMcp(...)`.
- **What breaks:** a rejected promise skips the `catch` that returns the generic 500, so the runtime sees an unhandled rejection. Both handlers have their own `try/catch`, so the risk is low today. It grows once ops routes are added.
- **Fix:** `return await ...`. Apply the same to any route added in F2.
- **Done when:** a test with a handler that rejects returns the generic 500 JSON, not a runtime error.

### F5. No tests for actors, webhook or MCP route
- **Where:** `tests/` holds only auth, leave, profile, signature and time.
- **What breaks:** AGENTS says a slice is not done without a happy path and a fallback. The lockout, replay and cancel behaviour has no evidence.
- **Fix:**
  - Pure decisions are tested as domain code (F1 covers lockout).
  - Add webhook tests for: bad signature (401), invalid payload (degraded response), KV failure (fallback and `kv: "fallback"`), actor timeout (`caller_status: "unknown"`), missing `HASH_KEY`.
  - Add `/mcp` tests for: no bearer (401), a bad method (405), invalid JSON (400), an invalid tool argument (`invalid_input`), and `get_leave_policy` with KV hit and miss.
  - For actors, fake `ctx.storage` with a `Map` and test replay, overlap, insufficient balance and the cancel-replay refund-once rule.
- **Done when:** `npm test` passes and the new tests are named in the DEVLOG entry.

## Medium

### F6. `isOpenNow` ignores company holidays
- **Where:** `src/domain/time.ts:182-211`, used at `src/webhook.ts:139` and `:266`.
- **What breaks:** on 26 Nov 2026 or 25 Dec 2026 the assistant says the HR desk is open.
- **Fix:** return `false` when today's date in the profile time zone (`todayIsoInTimeZone`) is in `profile.holidays`.
- **Done when:** a test shows `isOpenNow` is `false` at 10:00 on 2026-11-26 in `America/New_York`, and `true` at 10:00 on a normal weekday.

### F7. Validation messages contain raw ISO dates
- **Where:** `src/domain/leave.ts:125` and `:134`. These messages reach the voice model.
- **What breaks:** the caller hears "2026-07-01" read out digit by digit.
- **Fix:** format dates with `spokenIsoDate` from `src/domain/time.ts` (already written, currently unused). Update `tests/leave.test.ts`.
- **Done when:** the tests assert spoken dates such as "Wednesday, July 1".

### F8. Policy text can drift from the rules actually enforced
- **Where:** `src/config/default-profile.ts` (`policy.*` strings) against `entitlementDays`, `maxRequestDays`, `minNoticeDays`, `holidays`, `hours`; and `src/domain/profile.ts:34`.
- **What breaks:** a KV profile edit that changes a number but not the prose makes the assistant speak a policy different from the one enforced.
- **Fix (minimum):** add a test that `DEFAULT_PROFILE.policy` mentions `entitlementDays`, `maxRequestDays` and every holiday. Better: build the `entitlement`, `notice` and `holidays` text from the structured fields in `policyAnswer` and keep KV prose only for `carry_over` and `process`. If you take the better option, update TDD §8 and tell David.
- **Done when:** the test fails when a number in either place is changed.

## Decision for David (no code change until he decides)

### D1. `leave_changes_enabled` defaults to `true` when KV fails
- **Where:** `src/lib/kv.ts:58`, `src/webhook.ts:117`.
- **What breaks:** if ops pause changes and KV then fails, changes reopen. The actors still guard every change, and TDD line 240 states this default on purpose. So it is consistent with the TDD, but it makes the pause switch fail open.
- **Correction to the review:** the review said `degradedVariablesResponse` (`webhook.ts:267`, `"true"`) disagrees with the TDD's assistant-side default of `"false"` (TDD line 242). They cover different cases. The webhook answered, so `true` matches TDD line 240. `"false"` applies only when the webhook is unreachable. That part is not a bug.
- **David chooses:** keep fail-open, or fail-closed (`"false"`) with a notice.

## Low (batch into one commit, "review nits")

- **F9.** Add a `detail` value that separates "KV error" from "invalid KV profile" (`src/lib/kv.ts:34-37`), so ops can tell an outage from a typo in the stored profile. `src/webhook.ts:142` sends `context_status: "ready"` when KV fell back. That is correct: TDD §5 line 237 defines `ready` as "the webhook answered", and a degraded status would route every caller to N90. Leave it as is.
- **F10.** `src/mcp.ts:178` `nodeForTool` hard-codes `"N50"`. Use a lookup table. Also add `unavailable` to the code list in `outcomeFromMcpResponse` (`:160-166`) so the outcome matches TDD §7.2.
- **F11.** `src/tools.ts:55` casts `topic as PolicyTopic`. The type is already inferred, so remove the cast. Add `.describe()` text for each topic in `policyTopicSchema` (`src/domain/profile.ts:57`). Add `annotations: { readOnlyHint: true }` to the tool. The `catch` at `:62` swallows the error with no trace. Log nothing sensitive, but record a `detail` value.
- **F12.** Defence in depth in `src/actors/employee-leave.ts`: `apply` (`:210`) and `cancel` (`:304`) accept any date string. Reject input that is not `isIsoCalendarDate`, or whose start is after its end, with the same `throw new Error(...)` style used for the other input checks. Throwing commits nothing, per Telnyx's actor docs.
- **F13.** `src/lib/identity.ts:67-81`: `callerPseudonym` and `callerActorName` compute the same HMAC twice (the webhook calls both). Compute once and slice the first 8 characters. Also drop the employee number from `leaveRequestKey` (`:132`), since the actor is already per employee. Note in the TDD that a leaked `HASH_KEY` plus actor storage lets someone brute-force 4-digit PINs.
- **F14.** `src/actors/hr-desk.ts:244-260`: `_pruneUnknownEmployees` removes the oldest records first and can remove an active lockout. Remove expired locks first.
- **F15.** `src/lib/http.ts:27-41`: `readRawBody` reads the whole body before it checks the size. Stop reading at the limit using the body stream. `src/lib/auth.ts:37` accepts only the exact word `Bearer`. HTTP says the scheme is case-insensitive.
- **F16.** `src/domain/time.ts`: `todaySpokenInTimeZone` and `spokenIsoDate` repeat the same format options. Share them. `src/domain/leave.ts:20` and `:37` take holidays as a `Set` in one and an array in the other, so unify. `validateLeaveDates` throws on an invalid `todayIso` although it is typed to return a result.
- **F17.** `src/config/default-employees.ts`: the PINs `1111` to `4444` are easy to mis-hear. Pick varied digits, then run check C-7 with them.
- **F18.** `CompanyProfile` in `src/config/default-profile.ts` and `companyProfileSchema` in `src/domain/profile.ts` are two hand-kept copies. Derive the type from the schema with `z.infer`.

## Reviewer notes

- Not defects, kept as they are: actor methods use the `_` prefix for private helpers, which is what Telnyx's runtime needs because TypeScript `private` is erased. The `Promise.all` writes in actors are safe because Telnyx's docs say a turn that throws commits nothing. One log line per request in `finally` is correct.
- Open platform checks this code depends on: C-2 (MCP discovery and `_meta.telnyx_conversation_id`), C-3 (Ed25519 verification in the Edge runtime), C-5 (webhook timeout; TDD wants `dynamic_variables_webhook_timeout_ms` set to 3000 so the 2,000 ms deadline fits).
