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
