# Technical Design Document — HR Leave Assistant

Version 3.0 · 2026-11-12 · Status: design for a three-day build (Thu 12 – Sat 14 Nov 2026). Nothing is built or deployed yet.

Revision 3.0 changes the use case from an appointment receptionist to an HR leave assistant: an employee phones in, proves who they are, asks for their annual leave balance, and applies for or cancels leave. The platform design (Edge Function, KV, actors, workflow, MCP, observability) is unchanged in kind; the domain, the tools, the actors, and the identity step are new. Revision 2.0 is kept in [archive/v2.0-receptionist/](archive/v2.0-receptionist/TDD.md) and revision 1.1 in [archive/v1.1/](archive/v1.1/TDD.md). §16 lists what was cut and where to find it.

Requirements: [PRD.md](PRD.md). Assignment: `80639ad328bdbbcf732cba72559c894a/code_challenge.md`. Platform facts: [TELNYX_PLATFORM_RESEARCH.md](TELNYX_PLATFORM_RESEARCH.md). Source IDs such as [S01] resolve in §17. TDD means Technical Design Document.

## 1. What is built

An English phone assistant for the HR desk of a fictional company, Cedar Group. An employee dials a Telnyx number and hears a fixed AI disclosure. They can ask a leave-policy question, or give an employee number and PIN and then ask for their annual leave balance, apply for leave, or cancel leave. When the assistant cannot finish, it takes an HR callback request. It is a Telnyx AI Assistant with a Conversation Workflow, backed by **one TypeScript application on Telnyx Edge Compute** that serves the dynamic-variables webhook and a custom MCP server, using Telnyx KV and three Stateful Actors.

## 2. Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Language | TypeScript, strict, ESM | Node.js 24 locally. |
| Edge | `telnyx-edge` CLI (observed v0.5.17) and `@telnyx/edge-runtime` (observed 0.16.1) | Umbrella `telnyx.toml` project, because only that form declares actors. [S07, S08] |
| HTTP | Native `Request`/`Response` router in `src/index.ts` | Nine routes; no framework. |
| MCP | `@modelcontextprotocol/sdk` v1, web-standard Streamable HTTP transport, stateless, JSON responses | Fetch-native. The v2 package and its `createMcpHandler` were not confirmed, so v2 is tried only if v1 fails. Ladder in §13, check C-2; detail in [MCP_SERVER_SPEC.md](MCP_SERVER_SPEC.md). [S16] |
| Validation | Zod v4 | Tool inputs, webhook payload, KV values. |
| Crypto | Web Crypto: Ed25519 verify, HMAC-SHA-256, SHA-256 | No extra dependency. |
| Tests | Vitest for pure domain code; shell scripts against the deployed app | `telnyx-edge dev` needs Docker and does not emulate KV or secrets, so the deployed app is the integration environment. [S08] |
| Coding agent (builder) | OpenCode + `@telnyx/opencode` on a Telnyx-hosted model | Writes all solution code. Challenge requirement 6. See §14.2. |
| Review agent | Claude Code | Reviews each slice; writes no solution code. See §14.2. |

No database, queue, external collector, HR system, or frontend.

## 3. Architecture

```text
Caller (PSTN)
   |
Telnyx number -> AI Assistant + Conversation Workflow (11 nodes)
   |  (1) signed assistant.initialization      |  (2) MCP tool calls, bearer + session token
   v                                           v
+--------------------------------------------------------------------------+
| Edge Function: hr-leave-assistant                                        |
|  POST /webhooks/dynamic-variables        POST /mcp   (7 tools)           |
|  GET  /health/*   GET /ops/check         /admin/*    (operator)          |
|     |                |                 |                 |               |
|  env.HR_KV   env.CALLER_PROFILE  env.EMPLOYEE_LEAVE  env.HR_DESK        |
+-----|----------------|-----------------|-----------------|---------------+
      v                v                 v                 v
   Telnyx KV     CallerProfile     EmployeeLeave      HrDesk actor
   flag, policy  one per caller:   one per employee:  one, named cedar:
   profile       call counter      PIN lockout,       callback requests,
                                   balance, leave     unknown-number lockout
                                   requests, counters

Every request -> one JSON log line carrying call_ref  -> telnyx-edge logs
Platform      -> request counts, error rates, latency -> telnyx-edge metrics
Laptop probe  -> /ops/check + MCP tools/list every 15 s -> alert
```

Two separate paths share one `call_ref`. Path 1 runs once at call start: the webhook reads KV, records the call in `CallerProfile`, and returns variables. It never touches employee data. Path 2 runs whenever a workflow node calls a tool: the MCP handler checks the bearer, resolves who the employee is from a signed session token (§7.1), validates, reads KV where needed, and calls `EmployeeLeave` or `HrDesk`.

### 3.1 Which primitive owns what

| State or work | Primitive | Why |
| --- | --- | --- |
| Signature check, session token, policy validation (leave year, notice, holidays, working-day count), response shaping | Function | Stateless and safe to run anywhere, any number of times. |
| Pause flag `flags/leave_changes_enabled` | KV | Read on every call start and again on every apply or cancel, written rarely, a few seconds of staleness is harmless, changed without a redeploy. |
| Leave policy and company profile (name, hours, holidays, leave year, policy answers) | KV, with a bundled default | Read-heavy public content the operator can edit without a redeploy. A missing or bad value falls back to the bundled copy. |
| Per-caller call count | `CallerProfile` actor | A read-modify-write on one entity. Two simultaneous calls from one number must each count once; KV has no compare-and-set and would lose one. [S09, S11] |
| PIN attempts and lockout | `EmployeeLeave` actor | "Count this failure, and lock at three" is a read-modify-write. Parallel guesses must not get extra tries. |
| Leave balance, leave requests, the overlap check | `EmployeeLeave` actor | "Is there enough balance and no overlap? Then reserve it" must be one serialized step for one employee. The entity is the employee, so one instance per employee. Two simultaneous requests for the same employee cannot both spend the last days. [S09, S10] |
| Outcome counters for leave and verification | `EmployeeLeave` actor | They change in the same turn as the outcome they count, so they are exact and survive restarts. `/admin/stats` adds them up across the roster. |
| Callback requests; PIN-attempt count and lock for numbers that are not on the roster | `HrDesk` actor | One desk-level entity. A callback is not tied to a verified employee, and an unknown number must lock after three tries exactly as a real one does, or the lockout would reveal which numbers exist. |

Deliberately not in an actor: the policy profile and the flag (no read-modify-write). Deliberately not in KV: anything that decides whether a balance suffices, whether leave overlaps, or whether a PIN attempt is allowed.

### 3.2 The challenge's reference architecture

Copied unchanged from `80639ad328bdbbcf732cba72559c894a/code_challenge.md`, section "Architecture Overview". It is the picture the graders hold; §3 above is this design drawn in the same terms.

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

How this design maps to it:

| Challenge box | This design |
| --- | --- |
| Caller to Telnyx AI Assistant and Conversation Workflow | Phone number to the assistant, with the 11-node workflow of §6 |
| Dynamic Vars to Edge Function (Webhook) | `POST /webhooks/dynamic-variables` (§5) |
| KV and Actor inside the function | `env.HR_KV` plus the three actors of §8 |
| MCP Server (Custom) | `POST /mcp` with 7 tools (§7), a route in the same function, not a separate host |
| Workflow Routing evaluated by the Telnyx runtime | Variable and LLM edges (§6.2); nothing to build |
| Logs / Metrics | §10 |
| OpenCode with `@telnyx/opencode`, Telnyx Inference | §14.2 |

Two differences to explain on demo day: the MCP server shares the webhook's deployment (the challenge's Step 4 allows "an Edge Function or any public host"), and the MCP tools also reach the actors, because that is where leave is read and changed. The webhook never touches employee data.

## 4. Edge application

### 4.1 Manifest

Scaffold with `telnyx-edge new-func --actor --name=hr-leave-assistant`, then keep the generated `[edge_compute]` block. The challenge text shows `new-func … -l typescript` and `func.toml`; that classic form cannot declare actors. [S07]

```toml
name = "hr-leave-assistant"
main = "src/index.ts"
compatibility_date = "2026-05-01"   # keep the scaffold's value

[[actors]]
binding = "EMPLOYEE_LEAVE"
type    = "EmployeeLeave"           # must equal the class exported from src/index.ts

[[actors]]
binding = "HR_DESK"
type    = "HrDesk"

[[actors]]
binding = "CALLER_PROFILE"
type    = "CallerProfile"

[storage.kv.HR_KV]
id = "<namespace uuid from `telnyx-edge storage kv list`>"

[[secrets]]
binding = "MCP_BEARER"
name    = "HRLEAVE_MCP_BEARER"

[[secrets]]
binding = "OPS_TOKEN"
name    = "HRLEAVE_OPS_TOKEN"

[[secrets]]
binding = "HASH_KEY"
name    = "HRLEAVE_HASH_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "HRLEAVE_TELNYX_PUBLIC_KEY"

[edge_compute]
func_id   = "<written by new-func>"
func_name = "hr-leave-assistant"
```

`HASH_KEY` is one secret with four uses, kept apart by a prefix on the HMAC input: `caller|` for caller pseudonyms, `emp|` for employee pseudonyms and actor names, `pin|` for PIN hashes, `tok|` for session tokens.

Run `telnyx-edge types` after every binding change. Secrets are read with `env.SECRETS.get("<binding>")` and are injected at deploy time, so a changed secret needs a new `ship`. [S12]

### 4.2 Routes

| Route | Auth | Behavior |
| --- | --- | --- |
| `POST /webhooks/dynamic-variables` | Telnyx Ed25519 signature | §5. Always answers `200` with variables once the signature passes; `401` on a bad signature. |
| `POST /mcp` | `Authorization: Bearer <MCP_BEARER>` | §7. `401` without it. Employee tools also need a session token (§7.1). |
| `GET /health/liveness`, `GET /health/readiness` | Public | `200 ok`. No data. |
| `GET /ops/check` | Bearer `OPS_TOKEN` | Reads the KV flag, calls `ping()` on `HrDesk`, `CallerProfile`, and one `EmployeeLeave` instance, returns per-dependency status and milliseconds. `503` if any fails. |
| `GET /admin/requests?employee=NNNN` | Bearer `OPS_TOKEN` | Leave requests and balance for one employee number; without the parameter, for every employee on the roster. |
| `GET /admin/callbacks` | Bearer `OPS_TOKEN` | Callback requests. |
| `GET /admin/stats` | Bearer `OPS_TOKEN` | Outcome counters, summed over the roster plus `HrDesk`. |
| `POST /admin/reset` | Bearer `OPS_TOKEN` | Re-seeds the synthetic employees (balances, PIN hashes, no leave requests, no lockouts) and clears callbacks and counters for a clean demo. |

Processing order for every route: method and path, body size (32 KiB cap), authentication, schema validation, work, one completion log line in a `finally` block. Bearer comparisons are constant-time. Unknown paths return `404`.

## 5. Dynamic variables webhook

Telnyx posts once at the start of each voice call. [S03]

```json
{ "data": { "record_type": "event", "id": "event_…", "event_type": "assistant.initialization",
    "occurred_at": "2026-11-12T15:00:00Z",
    "payload": { "telnyx_conversation_channel": "phone_call",
      "telnyx_agent_target": "+1…", "telnyx_end_user_target": "+1…",
      "telnyx_end_user_target_verified": false,
      "call_control_id": "v3:…", "assistant_id": "assistant_…" } } }
```

Steps:

1. Read the raw body as text. Verify `telnyx-signature-ed25519` over `<telnyx-timestamp>|<raw body>` with the account public key, and reject timestamps older than 300 seconds. Parse only after verification. [S21]
2. Create `call_ref`: `c_` plus 12 random hex characters. It is a correlation ID, never a credential.
3. In parallel, inside a 2,000 ms deadline: read `flags/leave_changes_enabled` and `profile/current` from KV; call `CallerProfile.recordCall` unless the caller number is missing or withheld.
4. Compute `is_open_now`, `today_iso`, and `today_spoken` in the profile's time zone.
5. Respond and log one line.

```json
{ "dynamic_variables": {
    "company_name": "Cedar Group",
    "today_iso": "2026-11-12",
    "today_spoken": "Thursday, November 12",
    "is_open_now": "true",
    "leave_changes_enabled": "true",
    "caller_status": "returning",
    "context_status": "ready",
    "call_ref": "c_4f9a1c22b07e" } }
```

All values are strings, because voice variable comparisons use string literals. [S01]

| Variable | Source | Effect |
| --- | --- | --- |
| `company_name` | KV profile | Spoken in the disclosure. |
| `today_iso`, `today_spoken` | Function clock in company zone | Lets the model turn "next Monday" into a real date for the tools. |
| `is_open_now` | Profile hours | Changes callback wording; routes the transfer node when it exists (§6.3). |
| `leave_changes_enabled` | KV flag | **Routes** N30 and N40 to the paused notice. Balance enquiries are unaffected. |
| `caller_status` | `CallerProfile`: `new`, `returning`, or `unknown` | N01 says "Welcome back." for `returning`. No name, count, or history is ever spoken, and the number never identifies an employee. |
| `context_status` | `ready` when the webhook answered | **Routes** N01 to the degraded node when not `ready`. |
| `call_ref` | Webhook | Passed by the model to tools so logs join across both paths. |

Failure rules. A KV error or missing key uses the bundled profile and `leave_changes_enabled: "true"`, logged as `kv: "fallback"`; the actors still guard every change. A slow or failed profile actor gives `caller_status: "unknown"`. Neither fails the call.

Assistant-side defaults, used when the webhook is unreachable or late: `company_name: "Cedar Group"`, `context_status: "degraded"`, `leave_changes_enabled: "false"`, `is_open_now: "false"`, `caller_status: "unknown"`, `call_ref: "none"`. Set `dynamic_variables_webhook_timeout_ms` to 3000 (the default is 1500). [S03]

Caller recognition uses any presented number in this synthetic environment; `telnyx_end_user_target_verified` is logged so the README can state what real attestation looked like. **Caller ID never identifies an employee and never unlocks leave data.** Only the employee number and PIN do (§7.1).

## 6. Conversation Workflow

Assistant-level instructions hold identity, scope, style (short sentences, one question per turn), "never claim leave is approved, cancelled, or queued without a matching `approved`, `cancelled`, or `queued` tool result", "never say a PIN aloud", and "call the matching transition tool when a listed situation occurs". Every prompt node uses `instructions_mode: "append"` set explicitly, so the global rules stay active in every step. Never write "do not call tools" in any instruction: on calls, LLM edges are delivered as tools and such wording stops routing. [S01]

### 6.1 Nodes (must tier: 2 speak, 9 prompt)

| Node | Type | Job | Tools enabled |
| --- | --- | --- | --- |
| N00 Disclosure | Speak | "Thanks for calling {{company_name}} HR. I'm an AI assistant. I can tell you your annual leave balance, apply for or cancel leave, answer leave policy questions, or arrange a call back from the HR team." | — |
| N01 Intent | Prompt | Say "Welcome back." first when `{{caller_status}}` is `returning`. Find out what the caller wants. | none |
| N10 Verify and balance | Prompt | Ask for the four-digit employee number, then the four-digit PIN, one at a time. Call `verify_employee`. On `ok`, greet by first name, call `get_leave_balance`, and speak the remaining days and any upcoming leave. Remember the session token for later steps. Never say the PIN. | `verify_employee`, `get_leave_balance` |
| N12 Changes paused | Speak | "Leave requests and cancellations by phone are paused right now. I can take your details so the HR team can call you back." | — |
| N30 Dates | Prompt | Today is `{{today_spoken}}` (`{{today_iso}}`). Settle the first and last day of leave. Call `preview_leave` and say the number of working days and the days left afterwards. | `preview_leave` |
| N35 Confirm apply | Prompt | Read back first day, last day, working days, and days left. On a clear yes, call `apply_leave`. | `apply_leave` |
| N40 Cancel | Prompt | Settle which leave to cancel using the upcoming leave from N10, by its first day. Read it back with the days that will be restored. On a clear yes, call `cancel_leave`. | `cancel_leave` |
| N50 Policy | Prompt | Answer from `get_leave_policy` only; say so when the answer is not there. | `get_leave_policy` |
| N70 Callback | Prompt | The escalation path. Get consent, name, number, and reason; call `request_hr_callback`. Offer the number they are calling from, `{{telnyx_end_user_target}}`. When `{{is_open_now}}` is `false`, say the HR team will call on the next business day. | `request_hr_callback` |
| N80 Close | Prompt | Repeat the reference if there is one, offer further help, end the call. | hang up |
| N90 Degraded | Prompt | Apologize, say leave services are unavailable right now, ask the caller to try again later, end the call. | hang up |

Why two speak nodes: the disclosure and the paused notice must be delivered word for word, which a prompt node cannot promise.

Why verification and balance share N10: the first thing most callers want after proving who they are is their balance, and the balance call returns the upcoming leave that N40 needs. Apply and cancel are reached from N10, so identity is always settled first. The tools enforce this regardless of the graph (§7.1).

### 6.2 Edges

**V** is a variable comparison: evaluated by Telnyx before the model's turn, in the order listed, first match wins. **L** is an LLM condition: offered to the model as a transition tool; the call stays on the node until the model picks one. Speak nodes carry exactly one default edge; prompt nodes carry none. [S01]

| From | # | Type | Condition | To |
| --- | --- | --- | --- | --- |
| N00 | 1 | default | — | N01 |
| N01 | 1 | V | `context_status != "ready"` | N90 |
| N01 | 2 | L | The caller asks for a person. | N70 |
| N01 | 3 | L | The caller has a question about leave policy or HR hours. | N50 |
| N01 | 4 | L | The caller wants their balance, to apply for leave, or to cancel leave. | N10 |
| N10 | 1 | L | `verify_employee` returned `locked`, the caller cannot say the digits clearly after two tries (check C-7), or the caller asks for a person. A wrong PIN is not an unclear attempt: the caller keeps trying until the lockout. | N70 |
| N10 | 2 | L | Verified, and the caller wants to apply for leave. | N30 |
| N10 | 3 | L | Verified, and the caller wants to cancel leave. | N40 |
| N10 | 4 | L | The balance has been given and the caller wants nothing more. | N80 |
| N10 | 5 | L | The caller asks a general policy question instead. | N50 |
| N12 | 1 | default | — | N70 |
| N30 | 1 | V | `leave_changes_enabled == "false"` | N12 |
| N30 | 2 | L | `preview_leave` succeeded and the caller wants to go ahead. | N35 |
| N30 | 3 | L | The caller asks for a person, or `preview_leave` refused the dates twice, or the balance is too low and the caller accepts a call back. | N70 |
| N30 | 4 | L | The caller drops the request. | N80 |
| N30 | 5 | L | A tool returned `unauthenticated`. | N10 |
| N35 | 1 | L | `apply_leave` returned `approved`. | N80 |
| N35 | 2 | L | `apply_leave` returned `overlap` or `insufficient_balance`, or the caller wants different dates. | N30 |
| N35 | 3 | L | The caller decides not to apply. | N80 |
| N35 | 4 | L | The tool failed twice, or the caller asks for a person. | N70 |
| N35 | 5 | L | `apply_leave` returned `unauthenticated`. | N10 |
| N40 | 1 | V | `leave_changes_enabled == "false"` | N12 |
| N40 | 2 | L | `cancel_leave` returned `cancelled`. | N80 |
| N40 | 3 | L | The caller decides not to cancel. | N80 |
| N40 | 4 | L | `cancel_leave` returned `not_found` twice, the tool failed, or the caller asks for a person. | N70 |
| N40 | 5 | L | `cancel_leave` returned `unauthenticated`. | N10 |
| N50 | 1 | L | The caller wants their balance, to apply for leave, or to cancel leave. | N10 |
| N50 | 2 | L | The caller asks for a person, or the answer is not available. | N70 |
| N50 | 3 | L | The caller has no more questions. | N80 |
| N70 | 1 | L | `request_hr_callback` returned `queued`, or the caller declines a call back. | N80 |
| N70 | 2 | L | `request_hr_callback` failed. | N90 |
| N80 | 1 | L | The caller raises a new request. | N01 |

Routing choice: a variable edge is used where the answer is a fact the backend already knows (context loaded, changes paused), because it cannot be misheard or argued with. An LLM edge is used where the answer is what the caller means. The paused check sits on N30 and N40, not on N10, so a paused desk still lets employees hear their balance.

Variable expression shape:

```json
{ "type": "expression", "expression": { "type": "comparison", "op": "==",
    "left":  { "type": "variable", "name": "leave_changes_enabled" },
    "right": { "type": "string_literal", "value": "false" } } }
```

### 6.3 Should tier (day 3, only when the must tier is green)

- **N60 Transfer.** Human requests from N01, N10, N30, N35, N40, and N50 route to N60 instead of N70. N60 edges: 1 V `is_open_now == "false"` → N70; 2 L the transfer failed → N70. It uses the built-in transfer tool with one fixed destination number.
- **Time gate.** `telnyx_conversation_duration_secs >= 300` as a V edge on N01, N10, N30, N40, and N50, routing to the escalation node. Not on N35, so a caller in the middle of confirming is never pulled away. Set `telephony_settings.time_limit_secs: 480`.

### 6.4 Building and saving the graph

Build in the Portal's Workflow tab. After each change, save the API readback (`GET /v2/ai/assistants/{id}`) to `assistant/assistant.json` with `scripts/export-assistant.sh`, and keep node instructions in `assistant/instructions.md`. The committed JSON is the evidence of the saved graph.

Tool scope: each node's Tools tab starts with every assistant tool enabled, so turn off everything not listed in §6.1. Whether individual MCP tools appear there is check C-4.

Assistant privacy settings: set `privacy_settings.pii_redaction` to `redact` so stored history and tool arguments are redacted, and record the readback in `assistant/assistant.json`. It does not redact the live tool payload, which still carries the PIN to the function, so the function never logs a body (§9). [S02, TELNYX_PLATFORM_RESEARCH §4.3]

## 7. MCP server

`POST /mcp` verifies the bearer, then hands the request to the v1 SDK's web-standard transport, which serves a fresh server per request. No session map, no server-sent stream. The build, SDK ladder, logging, and grader-test details are in [MCP_SERVER_SPEC.md](MCP_SERVER_SPEC.md); where it differs from this section, the spec wins for the MCP slice. The Telnyx MCP server record is created in the Portal with type HTTP, the deployed `/mcp` URL, the Integration Secret that holds the same bearer value, and the seven tools allowed; it is then attached to the assistant under Integrations. The Portal's play button proves discovery only; a real call proves execution. [S05, S06]

### 7.1 Identity and session token

The bearer proves the request comes from Telnyx's assistant. It does not say which employee is on the line. Without more, a tool that took an employee number from the model would let any caller read or cancel anyone's leave. So:

- **Only `verify_employee` accepts an employee number.** No other tool takes an employee number, a name, or any identity field.
- `verify_employee(employee_number, pin)` checks the number against the bundled roster. For a roster number it asks that employee's `EmployeeLeave` actor to compare `HMAC(HASH_KEY, "pin|" + employee_number + "|" + pin)` with the stored hash and to count the attempt. Three failures in a row lock the employee for 15 minutes. For a number that is not on the roster it asks `HrDesk.failUnknown` (§8.5), which keeps the same count and the same lock under the number's pseudonym and never succeeds. Both paths return the same `auth_failed` code, the same wording, the same `attempts_left` countdown (2, 1, 0), and then the same `locked`, so no response shows whether a number exists.
- On success it returns `auth_token`: `v1.<employee_number>.<expiry>.<signature>`, for example `v1.1001.1762960000.9f2c…` (expiry is Unix seconds, 15 minutes after issue; the signature is the first 32 hex characters of the HMAC-SHA-256 of `tok|<employee_number>|<bind>|<expiry>` under `HASH_KEY`). `bind` is not in the token: the function recomputes it on every call from the request's own `params._meta.telnyx_conversation_id` (set by Telnyx, not by the model), or `none` when that is absent (the log line says so), so a token from another conversation fails the signature check. The token is about 52 characters of digits, dots and hex, with no mixed-case encoding for the voice model to garble.
- Every other employee tool takes `auth_token`. The function verifies the signature in constant time, the expiry, and that `bind` equals the request's own conversation ID; any failure is `unauthenticated`. The employee number comes from the token, never from an argument.
- The token is a credential for one call. It never appears in a log line.
- The model must pass the token back unchanged; check C-7 tests this. If it cannot, the fallback is a server-side session held in an actor and keyed by the conversation ID, which removes the token argument from the tools; that needs `_meta.telnyx_conversation_id` to arrive (check C-2).

Limits, stated in the README: a spoken PIN is demo-grade identity, and it passes through the speech and language models. Production would send a one-time code to a registered mobile through Telnyx Verify (§16). If Telnyx does not send the conversation ID, a token is valid for any call within its 15 minutes (check C-2 records which).

### 7.2 Tools

Every tool returns a short text block for the model plus structured content:

```ts
type ToolResult<T> =
  | { ok: true;  data: T }
  | { ok: false; code: ErrorCode; message: string };   // returned with isError: true
type ErrorCode = "invalid_input" | "unauthenticated" | "auth_failed" | "locked"
               | "out_of_policy" | "insufficient_balance" | "overlap"
               | "not_found" | "changes_paused" | "unavailable";
```

| Tool | Input | Success output | Behavior |
| --- | --- | --- | --- |
| `get_leave_policy` | `topic`: `entitlement` \| `notice` \| `carry_over` \| `holidays` \| `process` \| `hours` | Approved policy as short sentences | No sign-in needed. Reads the profile from KV (bundled default on a miss). Read-only. |
| `verify_employee` | `employee_number` (4 digits), `pin` (4 digits) | `auth_token`, `first_name` | §7.1. A wrong PIN returns `auth_failed` with `attempts_left`; a locked employee returns `locked`. |
| `get_leave_balance` | `auth_token` | `entitlement_days`, `used_days`, `remaining_days`, `upcoming[]` of `{ first_day, last_day, working_days, reference }` with spoken dates | Read-only. Upcoming means approved leave that starts after today. |
| `preview_leave` | `auth_token`, `start_date`, `end_date` (`YYYY-MM-DD`) | `working_days`, `remaining_after`, spoken dates | Function validates the dates (§8.3), counts working days, and asks the actor whether the balance and the calendar allow it. Read-only. Returns `changes_paused` when the flag is off. |
| `apply_leave` | `auth_token`, `start_date`, `end_date`, optional `call_ref` | `status: "approved"`, `reference` (for example `LV-7K2M`), `working_days`, `remaining_after`, spoken summary | Function rechecks the pause flag and the date rules, recomputes the working days (never accepts a count from the model), then calls `EmployeeLeave.apply`. A repeat of the same request returns the same reference. `insufficient_balance` and `overlap` change nothing. Annual leave within the balance is approved immediately; manager approval is out of scope. |
| `cancel_leave` | `auth_token`, `start_date`, optional `call_ref` | `status: "cancelled"`, `reference`, `working_days_restored`, `remaining_after` | Cancels the caller's approved leave that starts on `start_date`; only leave that has not started. A repeat returns `cancelled` with `replayed` and restores nothing twice. `not_found` for any date that is not the caller's own approved leave. |
| `request_hr_callback` | `caller_name` (≤ 80 chars), `callback_number` (E.164), `reason`: `leave_balance` \| `leave_request` \| `verification` \| `other`, optional `note` (≤ 200 chars), optional `call_ref` | `status: "queued"`, `reference` | No sign-in needed and no employee data returned. Stores one callback request. A repeat with the same number and reason on the same day returns the same reference. |

Rules: reject unknown keys; validate dates as real calendar dates; `employee_number` and `pin` match `^\d{4}$`; `call_ref` must match `^c_[0-9a-f]{12}$` or is logged as `invalid` and otherwise ignored; no tool accepts a URL, an employee number (other than `verify_employee`), a day count, or free-form JSON.

## 8. State

### 8.1 `CallerProfile` — one instance per caller

Instance name: hex HMAC-SHA-256 of the E.164 number under `HASH_KEY` with prefix `caller|`. The raw number is never an actor name or a log field.

```ts
recordCall(callId: string, nowIso: string): Promise<{ callCount: number; returning: boolean }>
ping(): Promise<"ok">
```

`recordCall` reads `callCount` and `recentCalls`; if `callId` is already in `recentCalls` it returns the stored answer unchanged; otherwise it increments, appends (keeping the last 20), stores `lastSeenAt`, and returns. `returning` is true when the count was above zero before this call. No one learns anything from it beyond "Welcome back." [S09]

### 8.2 `EmployeeLeave` — one instance per employee

Instance name: hex HMAC-SHA-256 of the employee number under `HASH_KEY` with prefix `emp|`. The function only instantiates names for numbers on the bundled roster, so guessed numbers create no actors.

| Storage key | Value |
| --- | --- |
| `profile` | `{ firstName, entitlementDays, openingUsedDays, pinHash, failedAttempts, lockedUntil }` |
| `requests` | Array of `{ reference, start, end, days, status: "approved" \| "cancelled", createdAt, cancelledAt, callRef }` |
| `key/<requestKey>` | Reference of the approved request; removed on cancel so the same dates can be applied for again |
| `counters` | `{ verified, authFailures, lockouts, approved, replays, insufficient, overlaps, cancelled, cancelReplays }` |

```ts
verifyPin(pinHash: string, nowIso: string):
  Promise<{ status: "ok"; firstName: string } | { status: "failed"; attemptsLeft: number }
        | { status: "locked"; minutesLeft: number }>
summary(todayIso: string): Promise<{ firstName: string; entitlementDays: number; usedDays: number;
  remainingDays: number; upcoming: { reference: string; start: string; end: string; days: number }[] }>
check(r: { start: string; end: string; days: number }):
  Promise<{ ok: true; remainingAfter: number } | { ok: false; reason: "insufficient_balance" | "overlap"; remainingDays: number }>
apply(r: { start: string; end: string; days: number; requestKey: string; callRef: string | null; nowIso: string }):
  Promise<{ status: "approved"; reference: string; remainingAfter: number; replayed: boolean }
        | { status: "insufficient_balance"; remainingDays: number } | { status: "overlap" }>
cancel(c: { startDate: string; todayIso: string; nowIso: string }):
  Promise<{ status: "cancelled"; reference: string; days: number; remainingAfter: number; replayed: boolean }
        | { status: "not_found" } | { status: "too_late" }>
requests() · stats() · reset(seed) · ping()
```

`used` is `openingUsedDays` plus the days of every approved request; `remaining` is `entitlementDays − used`.

`verifyPin` in one turn: if `lockedUntil` is in the future return `locked`; compare the hash in constant time; on a match zero `failedAttempts`, bump `verified`, return `ok`; otherwise add one to `failedAttempts`, and at three set `lockedUntil` to 15 minutes ahead, zero the count, and bump `lockouts`. This is the read-modify-write the challenge asks an actor to demonstrate: no lock is needed because the actor runs one method at a time, so parallel guesses are counted one by one. [S09]

`apply` in one turn: look up `key/<requestKey>` and return the earlier result if present; compute `remaining`; return `insufficient_balance` if `days > remaining`; return `overlap` if any approved request's closed date range intersects; otherwise append the request, write `key/…` and the counters, and return `approved`. Counters for refusals are bumped in the same turn. All writes of a turn commit together before the response. [S09, S10]

`cancel` in one turn: find the approved request whose `start` equals `startDate`. None: if a cancelled request has that start, return its result with `replayed: true`, else `not_found`. Found but `start <= todayIso`: `too_late`. Otherwise mark it cancelled, delete its `key/…`, bump `cancelled`, return the days restored.

`requestKey` is the SHA-256 of `employeeNumber|start|end`, computed in the function. It makes a retried or repeated confirmation harmless.

`reset(seed)` replaces the profile with the seed (the function computes `pinHash`), clears requests, key records, and counters.

### 8.3 Leave rules (pure functions in `src/domain/`)

- One company time zone, `America/New_York`. Dates are local calendar dates, `YYYY-MM-DD`. "Today" in that zone comes from `Intl.DateTimeFormat` with `timeZone`; domain functions receive it as an argument.
- A **working day** is Monday to Friday and not in the profile's `holidays`. `working_days(start, end)` counts them from the first day to the last day inclusive.
- Annual leave only, whole days only. A request is valid when: both dates are real and `start <= end`; `start` is at least `minNoticeDays` after today (1, so tomorrow at the earliest); both dates fall inside the leave year (`leaveYear.start` to `leaveYear.end`); it contains at least one working day; and `working_days <= maxRequestDays` (10).
- Overlap uses closed date ranges: `aStart <= bEnd && bStart <= aEnd`. Only approved requests count.
- Balance is checked inside `EmployeeLeave.apply`, not in the function.
- Cancel is allowed only for approved leave whose first day is after today.
- Reference format: `LV-` plus four characters from an alphabet without look-alikes. Callback references use `CB-`.

### 8.4 KV

| Key | Value | Written by |
| --- | --- | --- |
| `flags/leave_changes_enabled` | `"true"` or `"false"` | Operator: `telnyx-edge storage kv key put <ns> flags/leave_changes_enabled false` |
| `profile/current` | JSON: `companyName`, `timezone`, `hours` per weekday, `leaveYear { start, end }`, `holidays[]`, `minNoticeDays`, `maxRequestDays`, `policy { entitlement, notice, carry_over, holidays, process, hours }` (short approved sentences) | `scripts/seed.sh` from `src/config/default-profile.ts` |

Keys use slashes; KV keys cannot contain colons. A value that fails validation is treated as missing. [S11]

Demo data. Profile: Monday–Friday 09:00–17:00; leave year 2026-07-01 to 2027-06-30; holidays 2026-11-26, 2026-12-25, 2027-01-01; 14 days annual entitlement. The roster, with names, opening balances, and demo PINs, is `src/config/default-employees.ts` and is entirely synthetic:

| Number | Name | Entitlement | Used before today | Remaining | Used for |
| --- | --- | --- | --- | --- | --- |
| 1001 | Alex Rivera | 14 | 6 | 8 | The main journeys |
| 1002 | Priya Nair | 14 | 12 | 2 | Insufficient balance |
| 1003 | Sam Okafor | 14 | 9 | 5 | The concurrency test |
| 1004 | Jordan Lee | 14 | 0 | 14 | The lockout drill |

### 8.5 `HrDesk` — one instance, named `cedar`

| Storage key | Value |
| --- | --- |
| `callback/<reference>` | `{ name, phone, reason, note, callRef, createdAt }` |
| `callbackkey/<key>` | Reference, for replay |
| `unknown/<empHash>` | `{ failedAttempts, lockedUntil }` for a number that is not on the roster, keyed by its `emp\|` HMAC. At most 500 entries; the oldest is dropped first |
| `counters` | `{ callbacksQueued, callbackReplays, unknownEmployeeAttempts, unknownLockouts }` |

```ts
addCallback(c: { name: string; phone: string; reason: string; note: string | null; callRef: string | null;
                 callbackKey: string; nowIso: string }): Promise<{ reference: string; replayed: boolean }>
failUnknown(empHash: string, nowIso: string):
  Promise<{ status: "failed"; attemptsLeft: number } | { status: "locked"; minutesLeft: number }>
listCallbacks() · stats() · reset() · ping()
```

`callbackKey` is the SHA-256 of `phone|reason|date`. `failUnknown` runs when `verify_employee` gets a number that is not on the roster. It follows the same rule as `EmployeeLeave.verifyPin` in one turn: if locked return `locked`; otherwise count a failure, lock for 15 minutes at three, and return the countdown. It never returns success. This is what makes an unknown number indistinguishable from a real number with a wrong PIN.

## 9. Security floor

1. Verify the webhook signature on the raw bytes before parsing.
2. Bearer on `/mcp`; a separate bearer on `/ops` and `/admin`. Both fail closed when the secret is missing.
3. **No employee data without a valid session token.** Only `verify_employee` takes an employee number. Every other employee tool takes the signed, expiring, conversation-bound token and reads identity from it (§7.1). An unauthenticated call returns `unauthenticated` and touches nothing.
4. **PINs are guarded.** Stored only as an HMAC under `HASH_KEY`; compared in constant time; three failures lock the employee for 15 minutes; an unknown number and a wrong PIN answer identically, including the attempt countdown and the lock (`HrDesk.failUnknown`); the PIN is never spoken, logged, or returned.
5. Secrets live in Edge secrets and one Telnyx Integration Secret. None in the repository, logs, prompts, or screenshots. `.env` and `.telnyx/` are git-ignored.
6. Logs never contain a raw phone number, an employee number, a PIN, a name, a session token, an `Authorization` header, or a request body. Callers and employees appear as the first 8 hex characters of their HMAC.
7. Tools take typed, bounded inputs only. The transfer destination, when added, is fixed configuration.
8. Synthetic data only. Call recording stays off. Assistant `pii_redaction` is set to `redact` (§6.4).

## 10. Observability

### 10.1 Structured logs

One JSON line per webhook call, tool call, admin call, and ops check, written in `finally`:

```json
{ "ts": "2026-11-13T15:04:05.120Z", "level": "info", "event": "tool.completed",
  "call_ref": "c_4f9a1c22b07e", "conversation_id": "<from MCP _meta>", "caller": "9c1e44ab", "emp": "5d02b7e1",
  "node": "N35", "tool": "apply_leave", "outcome": "approved", "status": 200,
  "duration_ms": 142, "actor_ms": 61, "kv": "hit", "revision": "<deploy revision>" }
```

`conversation_id` is the Telnyx conversation ID, read from `params._meta.telnyx_conversation_id` on MCP tool calls and from the request payload on the webhook; it is omitted from lines that have neither. `caller` is the phone pseudonym, present on the webhook line; `emp` is the employee pseudonym, present on tool lines once a token or a roster number has been resolved. `node` is `initialization` for the webhook. For tools it is the node each tool is scoped to (§6.1), which the MCP request itself does not carry; the README says so. `outcome` is a fixed vocabulary: `ready`, `degraded`, `ok`, `verified`, `auth_failed`, `locked`, `approved`, `cancelled`, `replayed`, `insufficient_balance`, `overlap`, `out_of_policy`, `not_found`, `changes_paused`, `queued`, `invalid_input`, `unauthenticated`, `unauthorized`, `error`. `unauthorized` is a failed bearer or signature; `unauthenticated` is a missing, forged, expired, or foreign session token.

### 10.2 Signals beyond logs

| Signal | Where | Shows |
| --- | --- | --- |
| Request counts, 2xx/4xx/5xx rates, latency percentiles | `telnyx-edge metrics hr-leave-assistant`, `telnyx-edge actors metrics EmployeeLeave` | Traffic, errors, and latency with no application code. [S08, S22] |
| Outcome counters | `GET /admin/stats` | Verifications, failures, lockouts, approvals, replays, refusals, cancellations, callbacks; exact, because they change with the outcome. |
| Per-call trace | `scripts/trace.sh <call_ref>`, which filters `telnyx-edge logs --since 30m --json` | One call's path: webhook → KV → `CallerProfile` → tool → `EmployeeLeave`, with per-hop milliseconds. |

### 10.3 Knowing within a minute

`scripts/probe.sh` runs on the operator's laptop during the evaluation window. Every 15 seconds, with a 3-second timeout, it calls `GET /ops/check` and an authenticated MCP `tools/list`. Two consecutive failures raise a desktop notification and, when `ALERT_WEBHOOK_URL` is set, post to it. Worst case: 15 s wait + 3 s timeout + 15 s + 3 s = **36 seconds** plus delivery.

What it covers: the function is unreachable, KV or an actor is failing, the MCP endpoint or its auth is broken. What it does not cover: telephony, speech, the runtime model, or the saved workflow. Those are checked by a **smoke call** after every `ship` and before the demo. The README states both halves.

First look when it fires: `/ops/check` output (which dependency), then `telnyx-edge logs hr-leave-assistant --since 10m`, then `telnyx-edge deployments hr-leave-assistant` for a recent ship.

### 10.4 Incident record

When a real bug appears, write `docs/incidents/<date>-<name>.md` the same day: symptom, the log line or metric that exposed it, hypothesis, root cause, fix, and the check that proves the fix. This is a mandatory deliverable and it cannot be invented afterwards.

## 11. Failure handling

| Failure | Caller hears | Operator sees |
| --- | --- | --- |
| Webhook down or slow | Defaults apply; N01 routes to N90 | Probe alert; no `webhook.completed` line for the call |
| Bad webhook signature | Same as above | `outcome: "unauthorized"` |
| KV error or missing key | Normal call on the bundled profile | `kv: "fallback"` |
| `CallerProfile` slow or failing | Standard greeting | `caller_status: "unknown"` in the webhook line |
| Wrong PIN | "That didn't match", with tries left | `outcome: "auth_failed"` |
| Third wrong PIN | Locked for now; offered an HR callback via N70 | `outcome: "locked"`, `lockouts` +1 |
| Token missing, forged, expired, or from another call | Asked to verify again (N10) | `outcome: "unauthenticated"` |
| Balance too low or dates overlap at apply | Told why, back to N30 for other dates | `outcome: "insufficient_balance"` or `"overlap"`, counter +1 |
| Tool response lost, model retries | One request, same reference | `outcome: "replayed"` |
| Changes paused mid-call | Tool returns `changes_paused`; N35 routes to N70 | `outcome: "changes_paused"` |
| MCP auth broken | Tool errors; N35/N40/N70 route onward to the fallback | `outcome: "unauthorized"`, probe alert |
| `EmployeeLeave` failing | No success is claimed; callback or degraded path | `outcome: "error"`, probe alert |

Deadlines: webhook 2,000 ms internal; tools 4,000 ms. No automatic retries inside the function.

## 12. Tests

| Kind | Cases |
| --- | --- |
| Vitest, local | Working-day count across weekends and holidays; inclusive overlap; notice, leave-year, and maximum-length rules; invalid and non-real dates; balance arithmetic; `is_open_now` at boundaries; request-key stability; session token sign, verify, expiry, and conversation binding with a known vector; PIN hash and lockout logic; signature verification with a known vector; tool input validation. |
| `scripts/smoke.sh`, deployed | Health is 200; `/mcp` and `/admin` return 401 without a bearer; `tools/list` returns seven tools; an employee tool without a token returns `unauthenticated`. |
| `scripts/race.sh`, deployed | (a) Twenty parallel one-day `apply_leave` calls on distinct working days for employee 1003, who has five days: exactly five `approved`, fifteen `insufficient_balance`, final remaining zero, never negative. (b) The same request twice: one request, same reference. (c) Two parallel `cancel_leave` calls for one request: one `cancelled`, one replay, balance restored once. (d) Ten parallel wrong-PIN attempts for employee 1004: exactly three `auth_failed`, seven `locked`. (e) Two parallel `recordCall`s for one caller: count rises by two. (f) A token from one conversation presented under another: `unauthenticated`. (g) Four attempts on a number that is not on the roster: the same countdown and lock as employee 1004. |
| Phone calls | One per path: balance; apply; cancel; policy then balance; correction before yes; refusal at confirmation; three wrong PINs; paused changes; callback; second call from the same number; webhook defaults (point the assistant at a dead URL once). |

## 13. Checks that need the real account

Each has a time limit and a fallback so one surprise cannot consume a day.

| ID | Question | When, limit | If it fails |
| --- | --- | --- | --- |
| C-1 | Does an actor project ship on this account? | Day 1 morning, 60 min | Upgrade the CLI; message the challenge contact at once about entitlement. There is no substitute for actors. |
| C-2 | Does Telnyx's MCP client complete discovery and a tool call against the v1 SDK's web-standard transport inside the Edge runtime, and does `params._meta.telnyx_conversation_id` arrive on `tools/call`? | Day 1 afternoon, 2 h | First a hand-written JSON-RPC handler for `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`; then the v2 SDK, only if it is shown to be published and working. If the conversation ID is absent, tokens bind to `none` (§7.1) and the README says so. |
| C-3 | Does Ed25519 verification work in the runtime against a real request? | Day 1, 90 min | The `telnyx` SDK's webhook helper; then run with `WEBHOOK_VERIFY=log` (verify, log the result, do not reject) and list it as a limitation. |
| C-4 | Can individual MCP tools be toggled per node? | Day 1, 15 min of looking | Name the one allowed tool in each node's instructions and rely on server validation and the session token; state the limitation. |
| C-5 | Does the webhook answer inside the timeout on a cold start? | Day 1, measure | Raise the timeout up to 5000 ms; the probe also keeps the function warm during the demo. |
| C-6 | Is the built-in transfer usable from a node? (should tier) | Day 3, 45 min | Keep the callback path as the only escalation. |
| C-7 | Does speech recognition capture a four-digit employee number and a four-digit PIN reliably over a phone line, does the voice model hand the `auth_token` back unchanged to the next tool call (N10 to N30, N35, N40), and does `pii_redaction: redact` leave the digits and the token usable for the model? | Day 2, first call, 45 min | Ask for the digits one at a time and read the employee number back (never the PIN); after two unclear attempts route to the callback node (a wrong but clearly heard PIN counts toward the lockout instead). Record the failure rate. For the token, compare the one in the `verify_employee` result with the one in the next `tools/call` by length and a hash in the log, never by value; if it is altered, use the server-side session fallback in §7.1. |

Record each result in `docs/DEVLOG.md` and in `CLAUDE.md`'s unverified list.

## 14. Repository, provenance, and day-1 runbook

### 14.1 Layout

The repository root is the project directory (`Telnyx_Test`). The gist clone is git-ignored; `code_challenge.md` is linked, not republished, unless the challenge contact agrees.

```text
AGENTS.md  CLAUDE.md  README.md  DEMO.md  .gitignore
.opencode/opencode.json  .opencode/tui.json        # Telnyx plugin registration
docs/      PRD.md  TDD.md  MCP_SERVER_SPEC.md  TELNYX_PLATFORM_RESEARCH.md  DEVLOG.md
           incidents/  evidence/  archive/v1.1/  archive/v2.0-receptionist/
hr-leave-assistant/                                # created by new-func
  telnyx.toml  package.json  tsconfig.json
  src/index.ts                 # router; re-exports the three actor classes
  src/webhook.ts  src/mcp.ts  src/tools.ts  src/admin.ts
  src/actors/employee-leave.ts  src/actors/hr-desk.ts  src/actors/caller-profile.ts
  src/domain/leave.ts  src/domain/time.ts  src/domain/profile.ts
  src/lib/log.ts  src/lib/auth.ts  src/lib/signature.ts  src/lib/identity.ts   # pin hash, token
  src/config/default-profile.ts  src/config/default-employees.ts
  tests/
assistant/ assistant.json  instructions.md
scripts/   seed.sh  smoke.sh  race.sh  probe.sh  trace.sh  export-assistant.sh
```

Dependency direction: routes and tools call domain functions and actor stubs; domain code imports nothing from the platform.

### 14.2 Build and review workflow (challenge requirement 6)

Two tools with separate jobs, both directed by the developer, David:

| Role | Tool | Does | Does not |
| --- | --- | --- | --- |
| **Builder** | OpenCode coding agent with `@telnyx/opencode`, on a Telnyx-hosted model | Writes all solution code under `hr-leave-assistant/`, `scripts/`, and `assistant/`; runs tests; ships on David's go-ahead; writes the DEVLOG entry. Follows `AGENTS.md`. | — |
| **Reviewer** | Claude Code | Reviews each committed slice against this TDD, the `AGENTS.md` invariants, and the §9 security floor; checks that claimed evidence exists; maintains the planning documents. Follows `CLAUDE.md`. | Write or fix solution code. |

The loop per slice: OpenCode builds, verifies, and commits (the slice loop in `AGENTS.md`). Claude Code reviews that commit and reports findings to David, most severe first. David passes the findings he accepts to OpenCode, which fixes them in a new commit. Blocking findings (a broken invariant, a security-floor gap, a false success path) are fixed before the next slice starts; the rest are batched.

This satisfies the challenge's rule that Telnyx Inference powers the coding while allowing a comparison with another tool: the code's author is always the Telnyx-hosted model, and Claude Code's contribution is review and planning. The README states this split.

Records: `docs/DEVLOG.md` gets one entry per OpenCode session (date, model ID, what was built, what the model did well or badly) and one line per review (commit reviewed, findings raised, findings fixed). If David ever asks Claude Code to write something in the solution tree, it is logged in the DEVLOG as a disclosed exception.

### 14.3 Day-1 runbook

Billable or remote-changing steps are marked ($). Run each only deliberately.

```bash
# Repository
git init && git add -A && git commit -m "Planning documents"      # in the project root

# CLI (macOS arm64). Take the exact asset name and tag from the releases page.
#   https://github.com/team-telnyx/edge-compute/releases   -> telnyx-edge-v<ver>-darwin-arm64.tar.gz
#   Verify against SHA256SUMS before moving the binary onto PATH.
telnyx-edge auth api-key set <KEY>        # type it; keep it out of shell history
telnyx-edge auth status

# Scaffold and first ship ($ registers a function)
telnyx-edge new-func --actor --name=hr-leave-assistant
cd hr-leave-assistant && npm install
telnyx-edge ship                           # C-1: wait for "is now deployed"
curl -sS https://<printed-host>/health/liveness

# KV and secrets ($)
telnyx-edge storage kv create --name hrleave
telnyx-edge storage kv list                # copy the id into telnyx.toml
telnyx-edge secrets add HRLEAVE_MCP_BEARER       "$(openssl rand -hex 32)"
telnyx-edge secrets add HRLEAVE_OPS_TOKEN        "$(openssl rand -hex 32)"
telnyx-edge secrets add HRLEAVE_HASH_KEY         "$(openssl rand -hex 32)"
telnyx-edge secrets add HRLEAVE_TELNYX_PUBLIC_KEY "<public key from the Portal>"
telnyx-edge types && telnyx-edge ship
scripts/seed.sh                            # KV flag and profile, then POST /admin/reset to seed the employees
```

Keep the generated bearer values in a password manager; Telnyx cannot show a stored secret again. Rotating `HRLEAVE_HASH_KEY` invalidates every PIN hash, token, and actor name; run `scripts/seed.sh` again afterwards.

Portal steps ($): buy one voice-capable number; create the assistant with a Telnyx-hosted, tool-capable model and record its ID; set the dynamic variables webhook URL, the 3000 ms timeout, the §5 defaults, and `pii_redaction`; build N00 → N01; assign the number; call it. Then create the Integration Secret with the MCP bearer value, create the MCP server record, attach it, and ask the assistant a question that needs `get_leave_policy`.

Operations once deployed: `telnyx-edge logs <func> --tail`, `telnyx-edge metrics <func>`, `telnyx-edge deployments <func>`, `telnyx-edge rollback <func> <revision>`. A rollback changes code routing only; actor data stays. If `ship` times out, check `telnyx-edge ship status <func>` before shipping again.

## 15. Challenge evidence matrix

Every row needs real evidence before the README claims it.

| Requirement | Implementation | Proof to capture |
| --- | --- | --- |
| 1 Assistant, multi-node workflow, speak node, both edge types, phone number | §6 | `assistant/assistant.json`; a call that walks N00 → N01 → N10 → N30 → N35 → N80; a call routed by a variable edge. |
| 2 Custom MCP, ≥ 3 tools | §7 | `tools/list` output; log lines for at least three different tools from one call; the approved request in `/admin/requests`. |
| 3 Dynamic variables on an Edge Function | §5 | Webhook log line; first call versus second call greeting; paused flag changing the route. |
| 4a Edge Function, `telnyx-edge ship` | §4 | Ship output, deployment list, live URL. |
| 4b KV | §8.4 | `kv key put` of the flag followed by a rerouted call with no ship in between; `kv: "hit"` in logs. |
| 4c Stateful Actor | §8.1, §8.2 | `race.sh` output: five winners in twenty and a balance that never goes negative; three counted failures out of ten parallel wrong PINs; count rises by two for two parallel calls; data present after a redeploy. |
| 5 Logs, extra signal, one-minute detection, real bug | §10 | Log sample; `metrics` and `/admin/stats` output; timed outage drill with the alert time; incident file. |
| 6 OpenCode on Telnyx inference | §14.2 | `.opencode/opencode.json`, `opencode auth list` output, DEVLOG with model IDs and review lines. |
| 7 Public deployment and documentation | §14 | Phone number, URLs, README with one synthetic test employee number and PIN, DEMO.md. |
| Stretch, claimed only with proof | Variable comparison edges; KV feature flag; custom variables that route; `call_ref` correlation | The rows above already produce this evidence. |

## 16. Cut from revisions 1.1 and 2.0

Listed in the README as production hardening. The archive holds the design for the generic items; it was written for the appointment domain, so translate its booking terms to leave. Rows marked "no archive design" were never designed.

| Cut | Replaced by | Where |
| --- | --- | --- |
| Encrypted per-call MCP credential and call JWT | Static bearer plus the session token of §7.1 | archive v1.1 §7.3–7.4 |
| OTLP metrics export and collector | Platform metrics, actor counters, log trace | archive v1.1 §11.2–11.3 |
| Session and operation records, audit records | Request-key replay; counters | archive v1.1 §9.1 |
| Admin identity provider, backups, retention sweeps, key rotation | One operator bearer; `reset` | archive v1.1 §§5.2, 9.6, 10.2, 10.4 |
| MCP scoping adapter | Check C-4 and its fallback | archive v1.1 §6.3 |
| Sustained load profile, voice scenario corpus, SBOM, release automation | `race.sh`, one call per path | archive v1.1 §14 |
| One-time code to a registered mobile (Telnyx Verify) instead of a spoken PIN | Employee number plus PIN, lockout | no archive design |
| Manager approval workflow and notification | Immediate approval within the balance | no archive design |
| Other leave types, half days, carry-over, edits | Annual leave, whole days; cancel and re-apply | no archive design |
| Team coverage limits across employees | None | no archive design |
| HR information system as the source of balances | Synthetic roster in the actor | no archive design |
| Two-step hold and confirm protocol for writes | One idempotent `apply_leave` after a spoken readback | archive v1.1 §§8.3–8.4, 9.2–9.3 |

## 17. Sources

Retrieved 2026-11-10 unless noted. Saved copies in `/private/tmp/telnyx-*` are disposable; refetch from these URLs.

| ID | Source | Used for |
| --- | --- | --- |
| S01 | [Conversation Workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows.md) | Node types, edge evaluation, defaults, per-node tools, instruction modes. |
| S02 | [Create an Assistant API](https://developers.telnyx.com/api-reference/assistants/create-an-assistant.md) | `conversation_flow` schema, webhook timeout, telephony settings, `privacy_settings`. |
| S03 | [Dynamic Variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables.md) | Initialization payload, response, timeout, system variables. |
| S05 | [Create MCP Server API](https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server.md) | MCP server record, `api_key_ref`, `allowed_tools`. |
| S06 | [Add MCP Servers to an Assistant](https://developers.telnyx.com/docs/development/mcp/assistant-mcp-servers.md) | Integration Secret, attach, discovery versus execution. |
| S07 | [Bindings](https://developers.telnyx.com/docs/edge-compute/runtime/bindings.md), [Actor quick start](https://developers.telnyx.com/docs/edge-compute/stateful-actors/quick-start.md) | Umbrella manifest, actor export and stub typing. |
| S08 | [Edge CLI README](https://github.com/team-telnyx/edge-compute/blob/main/README.md) | `ship`, `logs`, `metrics`, `storage kv`, `dev` limits, rollback. |
| S09 | [Actor execution model](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/execution-model.md) | One method at a time; writes flushed before the response. |
| S10 | [Actor storage](https://developers.telnyx.com/docs/edge-compute/stateful-actors/api-reference/storage/index.md) | Turn atomicity. |
| S11 | [KV](https://developers.telnyx.com/docs/edge-compute/kv.md), [KvNamespace](https://developers.telnyx.com/docs/edge-compute/kv/reference/kv-namespace.md) | `get`/`put`, TTL, consistency, key rules. |
| S12 | [Edge secrets](https://developers.telnyx.com/docs/edge-compute/configuration/secrets.md) | `secrets add`, `[[secrets]]`, deploy-time injection. |
| S16 | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | v1 `@modelcontextprotocol/sdk` (`v1.x` branch) web-standard Streamable HTTP transport; v2 on `main` is a fallback only. |
| S21 | [Receiving webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks.md) | Raw-body Ed25519 verification. |
| S22 | [Edge Compute observability](https://developers.telnyx.com/docs/edge-compute/observability/index.md) (retrieved 2026-11-11) | Runtime and invocation logs, metrics, deployment history. Replaces the challenge's dead "Logs & Metrics" link. |
