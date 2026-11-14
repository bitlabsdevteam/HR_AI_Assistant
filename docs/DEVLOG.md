# DEVLOG

One entry per OpenCode session (date, model ID, wiki pages consulted, what was built, what went wrong) and one line per Claude Code review (commit reviewed, findings raised, findings fixed). Verification results for checks C-1 to C-7 are recorded here (TDD §13).

## 2026-11-12 — planning: grading criteria added to the instruction files (Claude Code, documents only)

- Added `docs/GRADING_MAP.md` (each "What We're Looking For" criterion mapped to the design, a build rule, evidence, and a demo-day line), a "What the graders score" section in `AGENTS.md`, and a grading checklist in the reviewer section of `CLAUDE.md`.
- Correction: an earlier statement that no file recorded the Function vs Actor vs KV reasoning was wrong. TDD §3.1 records it; a keyword search had missed it.
- No solution code written; no remote action taken.

## 2026-11-12 — planning: project changed to an HR leave assistant (Claude Code, documents only)

- David changed the project from an appointment receptionist to an HR leave assistant: an employee signs in by phone, hears the annual leave balance, applies for leave, and cancels leave.
- Revised `docs/PRD.md`, `docs/TDD.md` and `docs/MCP_SERVER_SPEC.md` to revision 3.0 / 2.0, plus `AGENTS.md`, `CLAUDE.md`, `README.md`, a note in `docs/TELNYX_PLATFORM_RESEARCH.md` and `docs/archive/v1.1/README.md`. Wiki entry pages and `Telynyx/log.md` updated.
- The previous documents are in `docs/archive/v2.0-receptionist/` (byte copies, except the old root README, restored as `PROJECT_README.md`).
- Design changes: sign-in by employee number and PIN; a signed session token so no tool after sign-in takes an employee number; per-employee `EmployeeLeave` actor (balance, requests, PIN lockout), `HrDesk` actor (callbacks), `CallerProfile` kept; seven tools; eleven nodes; KV flag `flags/leave_changes_enabled`; new check C-7 (spoken digits).
- No solution code written; no remote action taken. Nothing is built or deployed.
- Review (advisor, 2026-11-12), documents: raised 5 findings; fixed 3, reported 2 to David. Fixed: (1) an unknown employee number could not meet "answer identically to a wrong PIN" because it never locked, so `HrDesk.failUnknown` now keeps the same count, countdown and lock; (2) the session token was untested against the voice model repeating it, so C-7 now checks it, the signature is 32 hex characters, and a server-side session is the written fallback; (3) the Claude memory directory was checked and holds nothing stale. Reported, not design changes: grader state on a public number is shared (README says so, David runs `/admin/reset` first); the build load roughly doubled against revision 2.0 (7 tools, 3 actors, token and lockout), with nothing in the HR features to cut but the PRD §3.1 order.
- Also done: byte-copy backup before the rewrite; the archived root README had been overwritten, so `PROJECT_README.md` is a reconstruction, not a byte copy.

### Advisor rounds for the 2026-11-12 pivot (what each returned and what was done)

1. **Before writing.** Advisor said: back up the old docs first (not a git repo); rewrite TDD first, then PRD, MCP spec, AGENTS, CLAUDE, README; add a sign-in step with PIN, attempt counter and lockout in an actor; give no tool an employee number after sign-in (use a session token); per-employee actor; state leave rules and approval wording; rewrite race and acceptance tests; grep for leftovers and check names and § references. Done as advised, with `HrDesk` added as a desk-level actor.
2. **After the first draft.** Advisor raised five findings: (a) an unknown employee number could not behave like a wrong PIN because it never locked; (b) the token passing through the voice model was untested; (c) the memory directory had not been checked; (d) grader state on a public number is shared; (e) build load roughly doubled. Fixed (a) with `HrDesk.failUnknown`, (b) with a widened check C-7 and a server-side session fallback, (c) the directory was empty, nothing to change. (d) and (e) are reported to David and (d) is in PRD §11.
3. **After those fixes.** Advisor confirmed (a) to (d) are consistent across TDD, AGENTS, MCP spec and PRD and raised three more: the wiki's per-page notes and ratings must be rewritten too, because the goal says every markdown file and the builder reads the reading list first; the advisor's own earlier advice to leave them was withdrawn; the review must be visible in the transcript text; and the token length claim ("about 85 characters") was wrong. Done: wiki notes rewritten (see `Telynyx/log.md`, 2026-11-12 lint entry) and 19 pages re-rated; token format changed to `v1.<employee_number>.<expiry>.<32 hex>` with `bind` recomputed from `_meta` and left out of the token (about 52 characters).
4. **Final, after the wiki work.** Advisor found no further design problems and asked for two fidelity checks and a visible record. (i) Prose check: the 14 wiki pages that cite the six non-aggregate raw files containing the word "receptionist" were read for every line now saying "HR leave assistant"; all six such lines describe this project's relevance, none describes Telnyx's own content, nothing needed restoring beyond the two doc example names already restored. (ii) Catalog check: for 82 catalog and reading-list rows that mention the HR leave assistant, every sentence not about the project was compared with the page's own summary paragraph; all matched except link-markup differences (the pages write `[[raw/...|Title]]`, the catalog shows `Title`). One row ends mid-word ("Source: Pron"); many catalog cells were already cut at a fixed length before this session, so that is the catalog's existing style and was left. No made-up fact found. No other findings.
5. **After the stop-hook feedback.** The hook reported that no advisor call was visible and that about 300 "receptionist" mentions remained. Recount: 19 mentions in 11 wiki files, all deliberate (Telnyx's own example names and quotes, the challenge's "Smart Receptionist" idea, two intro notes about the rename, one kept alias); the project documents carry the word only in pivot notes; the archive folders and `raw/` are history and left alone. The pending scheduled wake-up was cancelled. The advisor reviewed this final state and raised no new findings.
6. **After repeated hook feedback.** State unchanged; the advisor confirmed the work is done, with no findings.

### 2026-11-12: Claude-authored comment edits in `hr-leave-assistant/src` (disclosed exception)

- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), Claude Code. David asked for it after the provenance conflict was raised once.
- Comment-only edits, no code changes: doc comments added to `config/default-profile.ts` (file note, every type and constant, each `CompanyProfile` field, `DEFAULT_PROFILE` fallback role), `config/default-employees.ts` (`DemoEmployee`), `env.ts` (members of the secrets, KV and actor-namespace interfaces), `index.ts` (`fetch`), `lib/http.ts` (`HttpRequestError` constructor), and the `textEncoder` constants in `lib/auth.ts` and `lib/identity.ts`.
- Not run: `npm run typecheck` and `npm test`, because `node_modules` is not installed. Comments do not change behaviour, but nothing was run to prove it.
- Review of `src/` (uncommitted, so no commit to cite): 9 findings raised to David (1 MCP tool only, no `/ops` or `/admin` routes, duplicated lockout logic, missing actor/webhook/mcp tests, un-awaited handler returns in `index.ts`, leave-changes flag defaults on KV failure, `isOpenNow` ignores holidays, ISO dates in spoken messages, policy text duplicating structured fields). Fixed: none yet.

## 2026-11-12 — build: Day 1 slice shipped and verified

- **Model**: OpenCode / Kimi-K2.6 (`telnyx/moonshotai/Kimi-K2.6`)
- **Wiki pages consulted**: None for this slice (outward actions only; code was already written).
- **What was built**:
  1. Fixed `signature.ts` type error (`Uint8Array` vs `BufferSource`).
  2. Added `createSessionToken` and `verifySessionToken` to `lib/auth.ts`.
  3. Implemented all 7 MCP tools in `src/tools.ts`: `get_leave_policy`, `verify_employee`, `get_leave_balance`, `preview_leave`, `apply_leave`, `cancel_leave`, `request_hr_callback`.
  4. Added `/ops/check` and all `/admin/*` routes (`requests`, `callbacks`, `stats`, `reset`) to `src/index.ts`.
  5. `npm run typecheck` passes; `npm test` passes (25 tests across 5 files).
  6. Deployed to Telnyx Edge:
     - `telnyx-edge new-func --actor --name=hr-leave-assistant` → func_id `903aedd3-9771-4f31-ad51-2d4160cd7127`
     - `telnyx-edge storage kv create --name=hrleave` → KV ID `1b0b0a50-c921-498d-9916-ec3f085da147`
     - Secrets added: `HRLEAVE_MCP_BEARER`, `HRLEAVE_OPS_TOKEN`, `HRLEAVE_HASH_KEY`
     - `telnyx-edge ship` → deployed in 4m26s
     - Live URL: `https://hr-leave-assistant-903aedd3-9.telnyxcompute.com`
  7. Seeded KV: `flags/leave_changes_enabled=true`, `profile/current` with Cedar Group defaults.
  8. Smoke test passed:
     - `/health/liveness` → 200
     - `/mcp` without bearer → 401
     - `/ops/check` without bearer → 401
     - `/mcp tools/list` with bearer → 200 (7 tools present)
     - `/mcp tools/call get_leave_policy` with bearer → returns correct policy text
     - `/admin/reset` with bearer → 200
     - `/admin/requests` with bearer → returns seeded employee roster
  9. Structured log lines visible in `telnyx-edge logs` with `call_ref`, `node`, `tool`, `outcome`, `duration_ms`, `kv` fields.
- **What went wrong / open items**:
  - `TELNYX_PUBLIC_KEY` secret not yet added (waiting on David to create API key). Webhook returns 401 until then.
  - `telnyx-edge dev` exposed that KV and secrets are not emulated locally; local dev should be reserved for actor logic only, not integration tests.
  - Telnyx wiki was not consulted for this slice because only outward actions were performed. Per AGENTS.md, the wiki is mandatory for platform feature usage; we only used CLI commands already documented in TDD §14.3 runbook.

**Commit**: `Day 1: actor scaffold, webhook, CallerProfile, KV read, seven MCP tools, admin/ops routes`

## 2026-11-13 — build: ticket #20 (secret-question MFA)

- **Model**: OpenCode / Kimi-K2.6 (`telnyx/moonshotai/Kimi-K2.6`)
- **Wiki pages consulted**: `Telynyx/index.md`, `Telynyx/wiki/entities/edge-functions.md`
- **What was built**:
  1. Added `answerHash` helper to `src/lib/identity.ts` (HMAC-SHA-256 of normalised answer).
  2. Updated admin `/reset` in `src/index.ts` to seed `secretQuestion` and `secretAnswerHash` from `DEFAULT_EMPLOYEES` into actors.
  3. Modified `verify_employee` tool in `src/tools.ts` to branch to secret-question MFA when employee has one configured: returns `needs_secret_question`, `question`, and `verification_token`.
  4. Added new `answer_secret_question` MCP tool: validates verification token (conversation-bound, 2-minute expiry), hashes answer, delegates to `EmployeeLeave.verifySecretAnswer`, issues `auth_token` on success or `auth_failed`/`locked` on failure.
  5. Updated `nodeForTool` in `src/mcp.ts` to map `answer_secret_question` to `N10`.
  6. Added `needs_secret_question` to `LogOutcome` in `src/lib/log.ts` and `outcomeFromMcpResponse`.
  7. Threaded `conversationId` from MCP request metadata into `createHrLeaveMcpServer`.
  8. Extracted `handleVerifyEmployee` and `handleAnswerSecretQuestion` into exported async functions for testability.
  9. Added `tests/tools-secret.test.ts` with 9 tests: happy path both branches, wrong PIN, locked account, correct/wrong secret answer, 3-strike lockout, expired token, wrong conversation ID.
  10. `npm run typecheck` passes; `npm test` passes (61 tests across 9 files).
  11. Deployed to Telnyx Edge: `telnyx-edge ship` → build succeeded after initial timeout; `telnyx-edge ship status hr-leave-assistant` confirmed success.
  12. Smoke test passed: health check, MCP 401 without bearer, admin/ops 401 without bearer, MCP `tools/list` with bearer (8 tools present including `answer_secret_question`), MCP `get_leave_policy` with bearer, admin reset with bearer, admin requests with bearer.
- **Code review**: Standards found 1 violation (verify_employee description outdated) and 1 smell (duplicated locked/failed/token logic in handlers); fixed description in follow-up commit.
- **What went wrong / open items**: None.

**Commits**:
- `9313be5 feat(#20): verify_employee branches to secret question; answer_secret_question tool`
- `e9304fc fix(#20): update verify_employee tool description for secret-question branch`

## 2026-11-13 — build: re-ship with bucket config fix and Langfuse secret guard

- **Model**: OpenCode / Kimi-K2.6 (`telnyx/moonshotai/Kimi-K2.6`)
- **Wiki pages consulted**: `Telynyx/index.md`, `Telynyx/wiki/telnyx-build-reading-list.md`, `Telynyx/wiki/telnyx-gotchas-all.md`, `Telynyx/wiki/entities/edge-functions.md`, `Telynyx/wiki/telnyx/edge-compute/edge-compute-cli-reference.md`
- **What was built**:
  1. Fixed `telnyx.toml` Cloud Storage bucket name (`hr-policy` vs old `hr-leave-assistant-policy`) and region (`us-central-1` vs old `us-east-1`) to match created infrastructure.
  2. Hardened `loadLangfuseCredentials` in `src/lib/langfuse.ts` with a `try/catch` so a missing secret binding throws no error into the request; tracing falls back to `"off"`.
  3. `npm run typecheck` passes; `npm test` passes (61 tests across 9 files).
  4. `telnyx-edge ship` → deployed in 4m1s. Smoke test passed: health check, MCP 401 without bearer, admin/ops 401 without bearer, MCP `tools/list` with bearer (8 tools present), MCP `get_leave_policy` with bearer, admin reset with bearer, admin requests with bearer.
  5. `telnyx-edge logs hr-leave-assistant --since 5m` shows expected `tool.completed` log lines with `outcome: "ok"` and `trace: "off"`.
- **What went wrong / open items**: None.

**Commit**: `fix: bucket name/region in telnyx.toml and guard Langfuse secret load`

## 2026-11-12 — build: added TELNYX_PUBLIC_KEY and re-shipped

- Added `HRLEAVE_TELNYX_PUBLIC_KEY` secret with the provided Ed25519 public key.
- `telnyx-edge ship` → redeployed in 3m36s.
- Webhook now returns 401 without a valid signature (fail closed as designed).
- Full end-to-end webhook test requires a real Telnyx `assistant.initialization` event with a valid Ed25519 signature.

**Commit**: `Day 1 deployment: telnyx.toml with real IDs, KV seeded, smoke scripts, DEVLOG entry`

## 2026-11-13 — build: remove secret-question MFA and fix session-token conversation binding

- **Model**: OpenCode / Kimi-K2.6 (`telnyx/moonshotai/Kimi-K2.6`)
- **Wiki pages consulted**: None (platform features unchanged; only code edits)
- **What was built**:
  1. Removed `answer_secret_question` tool from MCP server (`src/tools.ts`):
     - Deleted `handleAnswerSecretQuestion` function.
     - Removed tool registration and Zod schema.
     - Removed imports of `createVerificationToken`, `verifyVerificationToken`, and `answerHash`.
  2. Simplified `verify_employee` to issue `auth_token` immediately after PIN verification, bypassing the secret-question branch entirely. Description updated to match.
  3. Removed `answer_secret_question` from `nodeForTool` and `needs_secret_question` from `outcomeFromMcpResponse` and `isToolOutcome` in `src/mcp.ts`.
  4. Removed `needs_secret_question` from `LogOutcome` type in `src/lib/log.ts`.
  5. Updated `tests/tools-secret.test.ts`:
     - Changed the secret-question test to expect `auth_token` directly.
     - Removed all 5 `handleAnswerSecretQuestion` tests.
     - Removed unused imports.
  6. **Critical bug fix**: `resolveEmployeeFromToken` in all employee-scoped tools (`get_leave_balance`, `preview_leave`, `apply_leave`, `cancel_leave`) was called with `undefined` for `conversationId`, causing token verification to use `bind: "none"`. Since `verify_employee` and `answer_secret_question` (now removed) created tokens with the actual `conversationId`, the signature mismatch caused `unauthenticated` on every subsequent tool call. Fixed by passing the closure `conversationId` through to all four tool handlers.
  7. `npm run typecheck` passes; `npm test` passes (56 tests across 9 files).
  8. `telnyx-edge ship` → deployed in 4m10s.
  9. Smoke test passed: `tools/list` returns 7 tools (`answer_secret_question` absent).
  10. Verified end-to-end flow:
      - `verify_employee(1001, 1111)` → `auth_token` + "Welcome, Alex." (outcome: `verified`)
      - `get_leave_balance(auth_token)` → "You have 8 days remaining out of 14 days annual leave." (outcome: `ok`)
      - Token conversation binding works correctly across both calls.
- **What went wrong / open items**: The conversation-binding bug was latent until the token-creation fix from the prior session exposed it. It never showed in unit tests because mocks don\'t verify HMAC signatures.

**Commits**:
- `fix: remove secret-question MFA, fix token conversation binding in all tools`


## 2026-11-14 — fix #34: token handoff (Claude-authored, disclosed exception)

- **Provenance**: Claude Code (Sonnet 5.5, `claude-sonnet-5-5`) wrote this code at David's explicit request, against the project rule that OpenCode writes all solution code. Disclosed exception; needs reviewer attention accordingly.
- **Change**: `toolSuccess` and `toolError` in `hr-leave-assistant/src/tools.ts` now serialize the full envelope (`{ ok, data, message }` / `{ ok, code, message }`) into the text block as well as `structuredContent`, so a text-only consumer sees `data.auth_token`. Tool descriptions say `auth_token` is the exact `data.auth_token` from `verify_employee`. Signature, expiry and conversation-binding checks are untouched.
- **Tests**: `tests/token-handoff.test.ts` drives the real MCP server through the SDK in-memory transport: token read from text completes the balance lookup; employee number, greeting and PIN as token are rejected without reaching `summary`; a token from another conversation is rejected. 5 of 6 fail without the fix. `npm run typecheck` clean, `npm test` 62 passed.
- **Not verified**: no deploy, no voice call. Acceptance (`verify_employee` verified then `get_leave_balance` ok on one conversation, no token spoken or logged) is still open.
- **Portal step, not in this PR**: append to the `Verify_employee` node instructions: "After `verify_employee` succeeds, read `data.auth_token` from its JSON result. Pass that exact string unchanged as `auth_token` to `get_leave_balance` immediately. Never substitute the welcome greeting, the full response object, an employee number or PIN. Never invent, shorten or speak the token. If the result has no token, treat it as a tool failure and use the existing fallback. Read the remaining days only after `get_leave_balance` succeeds. If balance returns `unauthenticated`, verify once more; after another failure use the HR fallback."
- **Fallback if exact-copy is still unreliable**: conversation-keyed actor session (TDD 7.1 / C-7), separate issue.

## 2026-11-14 — build: ticket #46 (router catch log gap)

- **Model**: OpenCode / Kimi-K2.6 (`telnyx/moonshotai/Kimi-K2.6`)
- **Wiki pages consulted**: None for this slice (no platform features used; pure function fix).
- **What was built**:
  1. Added `"router.completed"` to the `event` union in `src/lib/log.ts`.
  2. Added `startedAt = Date.now()` before the router `try` in `src/index.ts` and a `writeCompletionLog` call in the router `catch`, producing one completion line with `outcome: "error"`, `status: 500`, `call_ref: "none"`, `duration_ms`. The raw error object is not logged; the 500 response body is unchanged.
  3. Added test in `tests/log.test.ts` that spies on `req.method` getter to force a synchronous throw inside the router (before any handler) and asserts exactly one JSON log line with the required fields. Also asserts the error message does not leak into the log.
  4. `npm run typecheck` passes; `npm test` passes (82 tests across 11 files).
  5. Committed on branch `docs/diagnostics-2026-11-14`.
- **Code review** (self-triggered after commit):
  - **Standards**: 1 hard violation raised — the invariant "One log line per request, written in `finally`" is breached because the router log is in `catch`; accepted as a necessary special case because a router-level `finally` would double-log every successful handler request.
  - **Spec**: 1 scope creep (`level: "error"` not requested) — removed within the same commit before final report; 1 test naming issue — renamed to "writes exactly one JSON log line when a synchronous throw occurs in the router before any handler runs".
- **What went wrong / open items**: None.

**Commit**: `85e7555 Add completion log to router catch block (#46)`

## 2026-11-14 — diagnosis: verification-to-balance token handoff

- **Investigator/model**: Codex (GPT-6; a more specific runtime model identifier is not exposed). Research and local diagnostics only; no solution-code authorship or Telnyx-hosted-model provenance is claimed for this entry.
- **Wiki pages consulted**: `Telynyx/index.md`; `telnyx-docs-hub`; `telnyx-build-reading-list`; `telnyx-gotchas-all`; `development-mcp-assistant-mcp-servers`; `assistants-models-tools-and-integrations`; `assistants-workflow-nodes`; `assistants-workflow-edges-and-routing`; `assistants-workflow-api-schema`; `assistants-dynamic-variables`; `assistants-conversation-keying`; `assistants-per-caller-encrypted-credentials`; `assistants-async-tools-add-messages`; `edge-compute-cli-reference`; `edge-compute-observability-logs-and-export`; generated API pages for assistant get/list/update, conversation get/messages, and MCP-server get. Current official Telnyx docs and MCP structured-content specification were also checked; sources are linked in the research note.
- **Observed failure**: Read-only logs located phone conversation `37032a37-f039-4dba-9d7d-8b2d4402ea8b` on 2026-11-13 around 22:37 JST. Verification succeeded three times; all five balance requests returned `unauthenticated` before actor access. The stored tool-call arguments used the preceding employee number as `auth_token` on all five attempts (length 4; equality verified in memory, values not retained).
- **Cause**: `toolSuccess` puts the signed token only in `structuredContent`, while the text block contains only a greeting. The recorded verification tool messages contain only that greeting. The malformed balance argument fails token-format validation before HMAC/conversation binding. The current binding fix does not resolve this separate result-format/handoff issue. The saved verification prompt says to keep the token but does not specify exact copying into `get_leave_balance`.
- **Checks**: Original application typecheck passed and all 56 tests passed. The separate diagnostic harness reproduces the employee-number-as-token refusal and demonstrates the missing text token: 3 pass, 1 fail. An isolated source copy changing only the success text to serialized `{ ok, data, message }` passes all 4 diagnostics, including the text-to-token-to-balance chain and wrong-conversation rejection. This is not a deployed voice-call fix.
- **Account/design differences**: The actual assistant graph differs from TDD N10; its current version has PII redaction disabled. Log `node: N10` is derived from the tool name and is not the portal node ID. Edge log `trace` is `off`; no Langfuse trace is claimed. The earlier DEVLOG's `conv_e2e_001` direct success is corroborated by logs but did not establish a successful voice-model token handoff.
- **Artifacts**: [Incident and concrete proposed solution](incidents/2026-11-14-verification-balance-token-handoff.md), [primary-source research](TELNYX_VERIFICATION_BALANCE_RESEARCH.md), and [sanitized evidence/diagnostics](diagnostics/README.md).
- **What went wrong during investigation**: Sandbox DNS initially prevented CLI/API reads; approved read-only retries succeeded. No assistant update, deployment, employee reset, new phone call or live MCP tool invocation was performed. Application source is unchanged; implementation and a synthetic voice-call acceptance test remain future work if requested.

## 2026-11-14 — diagnosis: HR transfer delayed by a balance lookup

- **Investigator/model**: Codex (GPT-6; a more specific runtime model identifier is not exposed). Diagnosis and sanitized local evidence only, no solution-code authorship claimed. Observed assistant model: `zai-org/GLM-5.3-Flash`.
- **Wiki pages consulted**: `Telynyx/index.md`; `telnyx-docs-hub`; `telnyx-build-reading-list`; `telnyx-gotchas-all`; `assistants-workflow-nodes`; `assistants-workflow-edges-and-routing`; `assistants-tools-library`; endpoint pages for Get Assistant, Get Specific Assistant Version, List Conversations, Get Conversation Messages, and Get MCP Server.
- **Evidence**: Read-only inspection of conversation `7761fb66-0b8d-446d-88cc-e3fbdf162248`, 2026-11-14 approximately 07:43 JST. Verification succeeded; `verify_employee_to_hr_manager` fired; `get_leave_balance` then ran successfully inside HR; the phone `transfer` tool was called later. The call version `20261113T224228900441` and current version `20261113T224621268085` have identical relevant node/edge/global instructions and MCP attachment settings. No Langfuse trace was fetched or generated for this investigation.
- **Cause/control gap**: The HR prompt already orders a transfer, but the model chose an available balance tool first. Both assistant and MCP-server allowlists are null. Runtime shows that the saved node `tools_mode: replace`/`shared_tool_ids` settings did not exclude this MCP tool. The successful HR edge rules out a missing transition as the cause of the delay; the successful balance result distinguishes this call from the earlier token failure.
- **Proposed correction**: For David's requested verification-and-transfer assistant, allow only `verify_employee` on its MCP attachment, retain the configured phone-transfer tool in manager nodes, explicitly direct the verification transition, and make transfer the manager node's immediate action. The prior immediate-balance portal recommendation is superseded for this flow. No MCP backend auth change is needed to change this ordering.
- **Check**: `python3 docs/diagnostics/check-verification-transfer.py docs/diagnostics/2026-11-14-verification-hr-transfer-evidence.json` fails on the real captured sequence: next business tool is `get_leave_balance`, expected `transfer`. This is an evidence replay, not a live model regression test or proof of a deployed fix. [Incident, exact proposed settings/prompts, and acceptance checks](incidents/2026-11-14-verification-hr-transfer-routing.md).
- **What went wrong / limits**: The initial message-only check missed workflow transitions because Telnyx records them separately in conversation metadata; incorporating `flow_transitions` corrected the diagnosis. No caller speech, PIN, token, employee number or tool body was saved. No remote write, deployment, new phone call or live business-tool invocation was performed. The manager destination's successful connection and Finance route are not established by this investigation.

## 2026-11-14 — research: Portal correction and newer HR transfer evidence

- **Investigator/model**: Codex (GPT-6; a more specific runtime model identifier is not exposed). Applied the repository research skill and delegated official-document reading to a fresh-context research agent. No application code or remote configuration was changed.
- **Wiki/source reading**: Required wiki index/hubs/build-reading/gotchas; MCP assistant integration; workflow nodes/edges/API schema; Tools Library; version testing and traffic distribution; exact assistant/MCP get, list, update, create and version endpoint references. The research agent checked current official public documentation against the local primary-source mirrors. [Research and source register](TELNYX_PORTAL_TRANSFER_RESEARCH.md).
- **New account evidence**: Conversation `acda819a-4457-45f9-adfd-3a11ac0a946d`, approximately 07:50 JST, used version `20261113T224936243181`. Verification succeeded, the HR edge fired, then `transfer` was invoked with no balance lookup. Current version `20261113T225131396332` retains the newer HR prompt. Compared with the 07:43 call's version, only the HR node changed in the inspected node settings; edges, global instructions, and MCP settings matched. The HR prompt now explicitly leaves HR questions to the receiving team and directs immediate transfer.
- **Revised recommendation**: Preserve the newer Portal HR prompt and the working verification edges. No new backend-code fix is indicated for this ordering issue. The `HR_MCP` allowlists remain null, so the optional allowlist restriction is additional enforcement, not a demonstrated prerequisite for the now-observed correct sequence. Portal server-level **Allowed tools** must not be described as a confirmed assistant-specific override UI; the latter is documented in the API only. Current-list reference inspection was inconclusive about whether the server is shared.
- **Validation**: The existing diagnostic fails on the 07:43 evidence and passes on [the newer sanitized call sequence](diagnostics/2026-11-14-verification-hr-transfer-after-prompt-evidence.json). This is one observed corrected sequence, not a guarantee of model behavior or proof of successful connection to the destination. No Langfuse trace was fetched/generated or phone call placed by this investigation.
- **Access limits**: Browser host unavailable; native Chrome inspection timed out. A read-only API check initially returned 401; running the previously approved CLI log reader refreshed the existing session and subsequent API reads succeeded. Portal click paths are backed by official documentation, not live UI observation. No credentials or raw caller speech were retained.
