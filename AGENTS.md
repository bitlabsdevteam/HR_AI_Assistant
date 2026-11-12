# HR leave assistant — build rules

A Telnyx coding-challenge submission: an AI phone assistant for an HR desk, on Telnyx Edge Compute. An employee signs in by phone, hears their annual leave balance, and applies for or cancels leave. Deadline: end of Saturday 14 Nov 2026. `docs/TDD.md` is the design; build what it says, nothing more.

You are the **builder**: the OpenCode coding agent, running on a Telnyx-hosted model, directed by the developer, David. You write all solution code. Claude Code is the **reviewer**: it reads each slice you commit and reports findings to David. A review finding reaches you as a fix request from David; fix it in a new commit and note it in `docs/DEVLOG.md`.

## Telnyx wiki: mandatory first read

Before you build, change, or debug anything that touches the Telnyx platform (Edge functions, actors, KV, assistants, workflows, MCP servers, webhooks, numbers, `telnyx-edge` CLI, API), you MUST open the wiki index at `/Users/davidbong/Documents/Telnyx_Test/Telynyx/index.md` (`Telynyx/index.md` from the project root). Do this at the start of every slice and again whenever you reach a platform feature you have not read about in this session.

1. From the index go to `wiki/telnyx-docs-hub.md`, `wiki/telnyx-build-reading-list.md`, and `wiki/telnyx-gotchas-all.md`, then to the section page or generated endpoint page for the exact command, config key, parameter, limit, or payload you are about to use.
2. Use the names, flags, enum values, and limits the wiki gives. Do not guess them or recall them from training.
3. Name the wiki pages you read in the slice's `docs/DEVLOG.md` entry.
4. The wiki is Telnyx's documentation, not proof for this account. If the wiki, the TDD, and observed runtime output disagree, runtime output wins; record it in `docs/DEVLOG.md` and tell David. Do not edit the wiki; Claude Code maintains it.

## Read before working

| When you are about to… | Read |
| --- | --- |
| Start any slice | `docs/TDD.md` §3 (architecture) and the section for that slice |
| Touch the webhook | TDD §5 |
| Touch workflow nodes, edges, or instructions | TDD §6 |
| Touch MCP tools, the session token, or the `/mcp` route | TDD §7, then `docs/MCP_SERVER_SPEC.md` (its deltas D1 and D2 win over the TDD) |
| Touch an actor, KV, or leave rules | TDD §8 |
| Handle a PIN, a token, or an employee number | TDD §7.1 and §9 |
| Log anything | TDD §10.1 |
| Hit platform behavior that contradicts the TDD | TDD §13, then record what you saw in `docs/DEVLOG.md` |
| Decide whether something is in scope | `docs/PRD.md` §3 |
| Touch any Telnyx platform feature, command, or config key | Wiki index `/Users/davidbong/Documents/Telnyx_Test/Telynyx/index.md` (mandatory, see above) |
| Check the assignment wording | `80639ad328bdbbcf732cba72559c894a/code_challenge.md` (read-only) |
| Wonder about a feature the TDD cut | TDD §16, which points into `docs/archive/v1.1/`. Read the archive for reference only. **Never build from `docs/archive/`**: it holds the earlier appointment-receptionist designs, whose tools, actors, and names are superseded by revision 3.0. |

## Challenge reference architecture

Copied unchanged from `80639ad328bdbbcf732cba72559c894a/code_challenge.md`, section "Architecture Overview". Our design (TDD §3) is the same picture with the HR domain: the webhook and `/mcp` are two routes of one Edge Function, the workflow is TDD §6, and the actors are TDD §8. Build toward this shape and do not add boxes it does not have.

```
┌─────────────────────────────────────────────────────────────┐
│                      Caller (Phone)                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Telnyx AI Assistant                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            Conversation Workflow                     │    │
│  │  Greeting (speak) → Identify Intent (prompt)         │    │
│  │      ├── Answer FAQ (prompt)                         │    │
│  │      ├── Collect Details (prompt)                    │    │
│  │      └── Escalate (prompt)                            │    │
│  └─────────────────────────────────────────────────────┘    │
│           │                  │                │               │
│     Dynamic Vars         MCP Tools      Workflow Routing     │
└───────────┼──────────────────┼────────────────┼─────────────┘
            │                  │                │
            ▼                  ▼                ▼
┌───────────────────┐  ┌──────────────┐  ┌──────────────────┐
│   Edge Function   │  │  MCP Server  │  │  (LLM conditions │
│   (Webhook)       │  │  (Custom)    │  │   evaluated by   │
│                   │  │              │  │   Telnyx runtime │
│  ┌─────┐ ┌─────┐ │  └──────────────┘  └──────────────────┘
│  │ KV  │ │Actor│ │
│  │     │ │     │ │      ┌─────────────────────┐
│  └─────┘ └─────┘ │      │  Logs / Metrics     │
└───────────────────┘      │  (your evidence)    │
                           └─────────────────────┘

Built using:
┌─────────────────────────────────────────────────────────────┐
│            OpenCode + @telnyx/opencode plugin               │
│    Powered by Telnyx Inference (current model list)          │
└─────────────────────────────────────────────────────────────┘
```

## Slice loop

Work in thin slices, in the order of `docs/PRD.md` §9. One slice is one behavior a caller or operator can observe.

1. **Build** the slice in `hr-leave-assistant/`. Pure rules go in `src/domain/` with a Vitest test.
2. **Check locally**: `npm run typecheck && npm test` pass.
3. **Ship**: `telnyx-edge ship` reports the function deployed. Shipping needs David's go-ahead each session (see Outward actions).
4. **Verify deployed**: `scripts/smoke.sh` passes, and the slice's log line appears in `telnyx-edge logs hr-leave-assistant --since 5m` with the expected `outcome`.
5. **Log**: add an entry to `docs/DEVLOG.md` with the date, the model ID you are running as, the wiki pages you consulted, what was built, and what went wrong.
6. **Commit** with a message naming the slice. The commit is what Claude Code reviews, so keep one slice per commit.

A slice is done when step 4 shows the expected log line from the deployed function. Passing local tests alone is not done.

When something breaks in a way that takes more than a few minutes to find, create `docs/incidents/<date>-<name>.md` the same hour: symptom, the log line or metric that exposed it, cause, fix, and the check that proves the fix. The challenge grades this record.

## Invariants

- **The actor decides.** Whether a balance covers a request, whether leave overlaps, and whether a PIN attempt is allowed are decided only inside `EmployeeLeave` methods, in one call. KV and the function hold nothing that answers those questions. The function counts working days; the actor never trusts a count for anything else.
- **Identity comes from the token.** Only `verify_employee` takes an employee number. Every other employee tool takes `auth_token` and reads the employee from it, after checking signature, expiry, and conversation binding. Check the token first; a bad one is `unauthenticated`.
- **Replay is safe.** `apply_leave` with the same employee, first day, and last day returns the same reference. A repeated `cancel_leave` restores days once.
- **Honest results.** A tool reports `approved`, `cancelled`, or `queued` only after the actor call returned it. Failures return `ok: false` with a code from TDD §7.2.
- **One log line per request**, written in `finally`, in the TDD §10.1 shape, carrying `call_ref`.
- **People are pseudonyms.** Logs and actor names carry the HMAC of a phone number or employee number, shown as its first 8 hex characters. Names, raw numbers, employee numbers, PINs, tokens, bearer values, and request bodies stay out of logs, error messages, and counters.
- **PINs are guarded.** Store only the HMAC. Compare in constant time. Answer an unknown employee number exactly as a wrong PIN: same code, same wording, same `attempts_left` countdown, same lock (`HrDesk.failUnknown` keeps the count for numbers that are not on the roster). Three failures lock the employee for 15 minutes. Never speak, log, or return a PIN.
- **Fail closed on auth.** A missing secret means `401`, on `/mcp`, `/ops`, and `/admin` alike.
- **Domain code is pure.** `src/domain/` imports nothing from `@telnyx/edge-runtime`; time comes in as an argument.

## What the graders score

The challenge grades more than "it works". `docs/GRADING_MAP.md` maps each criterion to this design; read it at the start of the build. The rules that follow from it:

- **Use the right primitive, and say why.** Stateless work in the function, read-heavy config and flags in KV, anything two writers can race on in an actor. If you add a piece of state, add a row to TDD §3.1 with its reason.
- **Speak node for text that must be word for word** (the disclosure, the paused notice). Every other step is a prompt node.
- **Variable edge for a fact the backend already knows; LLM edge for what the caller means.** Do not use an LLM edge where a variable would do.
- **Scope tools per node.** Switch off every tool a node does not need, and name the one tool in the node's instructions (check C-4).
- **Happy path and fallback path together.** A slice is not done until one call or test shows its happy path and at least one fallback (wrong PIN, insufficient balance, overlap, too-late cancel, tool failure, webhook default).
- **Voice UX.** One question per turn, short sentences, read back dates and counts before any change, never speak a PIN.
- **Evidence over claims.** Record the model ID in the DEVLOG each session, and write the incident file when a bug costs more than a few minutes.

## Platform gotchas

- The project is an umbrella `telnyx.toml`. All three actor classes are re-exported from `src/index.ts`, and each exported class name equals its `[[actors]] type`.
- After editing bindings in `telnyx.toml`, run `telnyx-edge types`. Secrets reach the function only on the next `ship`.
- KV keys use `/` as the separator. Colons are rejected.
- Every dynamic variable value is a string: `"true"`, `"false"`.
- Every prompt node sets `instructions_mode: "append"`.
- Word routing instructions as actions: "when the caller asks for a person, call the transition tool". On calls, LLM edges are tools, so wording that discourages tool use stops the workflow from moving.
- Logs reach `telnyx-edge logs` a few seconds after the request. Use `--tail` while testing.
- If `ship` times out, run `telnyx-edge ship status hr-leave-assistant` and wait for its answer.
- `telnyx-edge dev` does not emulate KV or secrets. Integration testing happens against the deployed function.

## Outward actions

These spend account credit or change remote state: `telnyx-edge new-func`, `ship`, `secrets add`, `storage kv create`, buying a number, creating an assistant or MCP server, and phone calls. Run one only when David has asked for that action in the current session. Read-only commands (`logs`, `metrics`, `deployments`, `inspect`, `storage kv key get`) are always fine.

Secrets live in Edge secrets and David's password manager. The demo employees and their PINs are synthetic and live in `src/config/default-employees.ts`; no real secret goes there. Commit `.opencode/opencode.json`; keep `.env`, `.telnyx/`, and auth stores out of git. Push only to David's repository; the gist clone's remote belongs to Telnyx.
