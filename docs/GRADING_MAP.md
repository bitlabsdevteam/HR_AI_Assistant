# Grading map: "What We're Looking For" to this design

Source: `80639ad328bdbbcf732cba72559c894a/code_challenge.md`, section "What We're Looking For" (read-only). This map says, for each graded criterion, where the design meets it and what evidence to capture. It does not add scope. Revision 3.0 (HR leave assistant), 2026-11-12.

Builders (OpenCode) apply the "Build rule" column. The reviewer (Claude Code) checks the "Evidence" column. David uses the "Say on demo day" column for the decision review.

## Technical Excellence

| Criterion | Build rule | Where in the design | Evidence | Say on demo day |
| --- | --- | --- | --- | --- |
| Clean, readable code, good architecture | Pure rules in `src/domain/`; routes and tools call domain functions and actor stubs; one slice per commit | TDD §14.1 | Layout in the repo; Vitest on domain code | Domain code imports nothing from the platform, so rules are tested without a runtime. |
| Proper error handling and edge cases | Every tool returns `ok: false` with a TDD §7.2 code; never claim success before the actor returns; replay-safe | TDD §7.2, §11 | Failure rows in the smoke and race scripts | Each failure has a named code, a spoken result, and a log outcome. |
| Smart use of Conversation Workflows: focused nodes, clear edges, speak nodes for verbatim text | One job per node; the disclosure and the paused notice are speak nodes; every edge condition is a short, testable sentence | TDD §6.1, §6.2 | `assistant/assistant.json` from `scripts/export-assistant.sh` | Two speak nodes because those texts must be word for word. |
| Correct use of Stateful Actors | Actor only for a read-modify-write on one entity | TDD §3.1, §8 | `race.sh` output | Parallel requests for the last days: one wins, the balance never goes negative. |
| Pragmatic KV | KV only for read-heavy config and the flag; never for a decision | TDD §3.1, §8.4 | Flag change reroutes a call with no `ship` | KV for what is read often and written rarely; the actor for anything two writers can race on. |
| Evidence-driven debugging | Incident file the same hour a bug costs more than a few minutes | AGENTS.md slice loop, TDD §10.4 | `docs/incidents/<date>-<name>.md` | The log line or metric that found it, not a guess. |
| Creative dynamic webhook variables on an Edge Function | Return only string values under `dynamic_variables`; variables must change the route | TDD §5 | Webhook log line; first call vs second call greeting; paused flag changes the route | Data from the webhook changes the route, not just the greeting. |
| Smart use of MCP | Typed, bounded inputs; no employee number after sign-in (token); tools scoped per node | TDD §7, `docs/MCP_SERVER_SPEC.md` | `tools/list` output; log lines for three tools from one call | Tools take a token, so the model never chooses whose data it reads. |

## Platform Understanding

| Criterion | Build rule | Where | Evidence | Say on demo day |
| --- | --- | --- | --- | --- |
| Right edge primitive for each job (Function vs Actor vs KV) | Follow TDD §3.1 table; if a new piece of state appears, add a row with its reason | TDD §3.1 | The table | Read the "Deliberately not in an actor / not in KV" sentence. |
| When a node should append vs replace instructions | Every prompt node sets `instructions_mode: "append"` | AGENTS.md gotchas, TDD §6 | `assistant.json` | Assistant-level rules (identity, never claim success, never say a PIN) apply on every node; each node adds only its job. |
| Scoping tools per node | Switch off every tool a node does not need; name the one tool in the node's instructions | TDD §6.1; check C-4 | Portal Tools tab and `assistant.json` | Fewer tools on a node, fewer wrong calls. State the C-4 result honestly. |
| Variable comparisons vs LLM conditions | A variable edge for a fact the backend knows; an LLM edge for what the caller means | TDD §6.2 "Routing choice" | Edge table; a call routed by each type | A variable edge cannot be misheard or argued with. |

## Innovation and Creativity

| Criterion | Build rule | Where | Evidence | Say on demo day |
| --- | --- | --- | --- | --- |
| Unique or interesting use case that leverages the multi-step workflow | n/a | PRD | Eleven-node workflow | Sign in, balance, apply, cancel: each step depends on the one before. |
| Thoughtful UX for voice | One question per turn; short sentences; read back dates and counts; never say a PIN; handle unclear digits (check C-7) | TDD §6 assistant instructions | Call recordings or notes from real calls | Digits one at a time; read-back before any change. |
| Creative problem-solving with stateful edge services | PIN lockout and balance in the actor | TDD §8.2 | `race.sh`, lockout drill | Three parallel wrong PINs count exactly three failures. |
| Effective use of Telnyx-hosted inference for development | OpenCode on a Telnyx model; DEVLOG records the model ID each session | AGENTS.md slice loop, TDD §14.2 | `.opencode/opencode.json`, DEVLOG | What worked and what did not. |

## Real-world Viability

| Criterion | Build rule | Where | Evidence | Say on demo day |
| --- | --- | --- | --- | --- |
| Solves an actual problem | n/a | PRD | README | Employees check and book leave without waiting for HR. Data is synthetic. |
| Realistic flows with edge cases | Test at least one negative case per important node (wrong PIN, insufficient balance, overlap, too-late cancel) | TDD §12 | Test and call list | Each negative case has a result. |
| Practical value of the edge architecture | n/a | TDD §3 | Live URL; KV and actor evidence | One function, state next to compute, no database to run. |
| **Happy path AND fallback paths** | **Every slice proves its happy path and at least one fallback before it counts as done** | TDD §11, §12 | One call per path in the DEVLOG | Webhook down, KV missing, tool failing: the caller still gets an honest answer. |

## Not on the grading list but required

Observability (README, one-minute detection, real bug) and OpenCode provenance are separate mandatory requirements. See TDD §10, §14.2, and §15.
