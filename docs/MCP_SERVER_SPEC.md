# MCP server: build spec for OpenCode

Revision 2.0, 2026-11-12. Author: Claude Code (planning). Builder: OpenCode. Reviewer: Claude Code. Revision 1.0 (the appointment receptionist) is kept in `archive/v2.0-receptionist/MCP_SERVER_SPEC.md`.

This spec tells OpenCode how to build, deploy, and prove the `/mcp` route of `hr-leave-assistant`. It adds to `docs/TDD.md` §7 and does not replace it. Tool contracts (names, inputs, outputs, error codes) and the session token stay in TDD §7 and are not repeated here. Read the wiki first, as `AGENTS.md` requires.

## 0. Precedence and deltas to the TDD

The TDD carries both deltas below (§2 stack row, §7, §10.1, §13 C-2, S16), so the two documents agree. If they ever differ again, this spec wins for the MCP slice. Record each delta in `docs/DEVLOG.md`.

| # | TDD says | This spec says | Why |
| --- | --- | --- | --- |
| D1 | v1 SDK by default; v2 only as a fallback | Default to the v1 SDK, `@modelcontextprotocol/sdk`. Use v2 only if check C-2 passes on v2 first. | v2's package name, handler and stateless options could not be confirmed from the docs read so far. |
| D2 | §10.1 log line carries `conversation_id` | MCP tool lines carry `conversation_id` (§6 below). | Challenge §5 asks for a trace of one call across Function, KV/Actor and MCP. |

## 1. Challenge requirements this slice must meet

Source: `80639ad328bdbbcf732cba72559c894a/code_challenge.md` (read-only).

| Challenge | Requirement | Acceptance evidence |
| --- | --- | --- |
| §2 | Custom MCP server, at least 3 tools callable by workflow nodes | `tools/list` returns 7 tools; deployed log lines for at least 3 different tools from one real call |
| §4 | Backend on Telnyx Edge Compute, not another host | `/mcp` is a route of the one function shipped with `telnyx-edge ship` |
| §5 | Structured logs with caller, node, outcome, plus one signal beyond logs, plus a Function to KV/Actor to MCP trace | §6 and §7 below |
| §7 | Publicly accessible, with working URLs and instructions graders can follow | §8 below |
| Demo day | A tool call during a live conversation | A phone call that checks a balance, applies for leave, or requests a callback; the log lines exist |
| Pro tip | Tools scoped per node | TDD §6.1 toggles; check C-4 |

## 2. Hosting and transport

- The MCP server is `POST /mcp` inside the existing function. It is not a separate function or host.
- Transport is Streamable HTTP, stateless: no session map, no GET stream, no server-sent events. The Telnyx Portal record uses type **HTTP**.
- Use JSON responses (not an event stream) if the SDK offers that option. Do not guess option names: read the installed package's type declarations and the wiki pages named in §9.

### SDK ladder (check C-2, 2 h limit)

Try each step in order. Move on when one fails to complete `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` inside the Edge runtime. Record every step's result in `docs/DEVLOG.md`.

1. v1 `@modelcontextprotocol/sdk`, with its web-standard (fetch `Request`/`Response`) Streamable HTTP transport, one server instance per request, session id generation off.
2. A hand-written JSON-RPC handler for the four methods above, returning JSON.
3. v2 `@modelcontextprotocol/server` and `createMcpHandler` only if step 1 fails and you can show v2 is published and works. Do not make it the default.

Do not use a Node-only transport that needs `http.IncomingMessage` unless it runs in the Edge runtime.

## 3. Tools

The seven tools, their inputs, outputs, error codes, replay rules, and validation rules are exactly TDD §7.2; identity is TDD §7.1. This spec adds only:

- Tool descriptions are written for a voice model: one or two plain sentences, no markup, saying when to call the tool and what the arguments mean. `verify_employee`'s description says to ask for the employee number and then the PIN, one at a time, and never to repeat the PIN. The description of every tool that takes `auth_token` says to pass the token from `verify_employee` unchanged.
- Every tool result is the TDD `ToolResult<T>` shape. Failures use `isError: true` and a code from the TDD list. A tool never returns `approved`, `cancelled`, or `queued` until the actor call has returned it (AGENTS.md invariant "Honest results").
- Only `verify_employee` accepts an employee number. Do not add an identity argument to any other tool. The employee comes from the verified token (AGENTS.md invariant "Identity comes from the token").
- Tools are called from prompt nodes only. Do not add a tool node that runs an MCP tool. A tool node runs a shared, webhook-style tool, and no Telnyx page says it can run an MCP tool.
- Every tool call completes within the 4,000 ms tool deadline (TDD §11). On timeout, return `unavailable` and log `outcome: "error"`.

## 4. Authentication

Two layers, both required for employee tools.

**Bearer (all of `/mcp`).**

- `/mcp` requires `Authorization: Bearer <HRLEAVE_MCP_BEARER>`. Compare in constant time. A missing secret, a missing header or a wrong value returns `401` and logs `outcome: "unauthorized"`.
- **Unverified:** Telnyx's docs say the Portal "API Key" field selects an Integration Secret but never name the header it sends. The per-caller credentials page implies `Authorization: Bearer`. Confirm it on the first Portal discovery (the play button):
  - Add a temporary diagnostic that logs the **names** of the request headers and whether an `Authorization` header with scheme `Bearer` was present. Never log the header value, the token, or the body (TDD §9.6).
  - Record the result in `docs/DEVLOG.md`, then remove the diagnostic in the next commit.
- If Telnyx sends a different header or scheme, stop and tell David. Do not loosen auth to make discovery pass.

**Session token (employee tools).** `get_leave_balance`, `preview_leave`, `apply_leave`, and `cancel_leave` need a valid `auth_token` (TDD §7.1). A missing, malformed, forged, expired, or wrongly bound token returns `unauthenticated` and logs `outcome: "unauthenticated"`. Check the token before any other work, including the KV flag read. Token and PIN never appear in a log line, an error message, or a counter label.

## 5. Request handling order for `/mcp`

Follow TDD §4.2: method and path, body cap (32 KiB), authentication, schema validation, work, one completion log line in `finally`. Reject unknown keys on every tool input.

Read `params._meta.telnyx_conversation_id` from each `tools/call` request. It is set by Telnyx, not by the model. Validate it as a bounded string; if it is absent or malformed, log it as `invalid` and continue; the session token then binds to `none` (TDD §7.1). It is the `bind` value that `verify_employee` signs into the token and that every other employee tool checks.

## 6. Logging (challenge §5)

One JSON line per `tools/call`, plus one per `initialize` and `tools/list`, written in `finally`. Use the TDD §10.1 shape and add `conversation_id`:

```json
{ "ts": "...", "level": "info", "event": "tool.completed",
  "call_ref": "c_4f9a1c22b07e", "conversation_id": "<from _meta>", "caller": "9c1e44ab", "emp": "5d02b7e1",
  "node": "N35", "tool": "apply_leave", "outcome": "approved", "status": 200,
  "duration_ms": 142, "actor_ms": 61, "kv": "hit", "revision": "<deploy revision>" }
```

- `node` is derived from the tool name using the TDD §6.1 table: `get_leave_policy` N50; `verify_employee` and `get_leave_balance` N10; `preview_leave` N30; `apply_leave` N35; `cancel_leave` N40; `request_hr_callback` N70. The MCP request does not carry the node, and the README says so.
- `outcome` uses only the TDD §10.1 vocabulary.
- `emp` is the first 8 hex characters of the HMAC of the employee number, present once a token or a roster number has been resolved. `caller` is the first 8 hex characters of the phone HMAC and is normally present only on the webhook line. No raw phone number, employee number, PIN, name, token, bearer, or request body appears in any log.
- `scripts/trace.sh <call_ref>` must show the MCP leg between the webhook line and the actor hop.

## 7. Signals beyond logs

- Outcome counters in `EmployeeLeave` and `HrDesk` and `GET /admin/stats` (TDD §10.2). Add a per-tool call count and latency if cheap.
- `scripts/probe.sh` sends an authenticated `tools/list` every 15 seconds (TDD §10.3).
- Use the platform metrics from `telnyx-edge metrics hr-leave-assistant` as a second source.

## 8. How graders test a bearer-protected endpoint (challenge §7)

David's decision (2026-11-12): keep the bearer and document the test. Never put the bearer token in the repository, a log, a screenshot, or the README.

The README must contain:
1. The public MCP URL, and the statement that it returns `401` without a token.
2. The primary test: call the phone number and say a phrase that triggers a tool. For the policy tool, ask how much notice leave needs. For the personal tools, give the synthetic test employee number and PIN that the README lists, then ask for the leave balance; the README gives the phrases and the log lines to expect. The test employee is synthetic and its PIN is not a secret.
3. The curl command for a token holder, with the token as a placeholder:

```bash
curl -sS -X POST "$URL/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

   Some servers require an `initialize` request before `tools/list`; if yours does, document that sequence.
4. A pointer to the saved `scripts/smoke.sh` output in `docs/evidence/`.

David shares the bearer token with graders privately, if he chooses to.

## 9. Wiki pages to read before building

From `Telynyx/wiki/`: `telnyx/development/development-mcp-assistant-mcp-servers`, `telnyx/assistants/assistants-models-tools-and-integrations`, `telnyx/assistants/assistants-async-tools-add-messages`, `telnyx/assistants/assistants-per-caller-encrypted-credentials`, `telnyx/assistants/assistants-workflow-nodes`, `entities/mcp-server`, and `analyses/telnyx-build-critical-facts`. Name the ones you used in the DEVLOG entry.

## 10. Slice plan

Each slice is one commit with a DEVLOG entry (AGENTS.md slice loop).

| Slice | Done when |
| --- | --- |
| M1 Skeleton and auth | `POST /mcp` returns `401` without a bearer and without a configured secret. A Vitest test covers it. A deployed `smoke.sh` check shows `401`. |
| M2 Discovery (C-2) | The Portal play button shows "MCP server connected successfully". `tools/list` returns the 7 tools. The log line has `event` for discovery. The header diagnostic result is recorded. |
| M3 Policy tool | `get_leave_policy` works in a deployed call. Log lines show `conversation_id` (or its absence, recorded). |
| M4 Sign-in and balance | `verify_employee` and `get_leave_balance` work in a deployed call: wrong PIN, lockout, token expiry and wrong-conversation token each return the TDD code. An unknown employee number follows the same countdown and lockout as a wrong PIN. Vitest covers the token. Employee tools without a token return `unauthenticated`. The token reaches the next tool call unchanged (check C-7). |
| M5 Write tools | `preview_leave`, `apply_leave`, `cancel_leave`, and `request_hr_callback` work, including replay, `insufficient_balance`, `overlap`, and double cancel. `race.sh` passes. `race.sh` and `smoke.sh` call `/mcp` with the bearer and set `params._meta.telnyx_conversation_id` themselves, as Telnyx does on a call; the bearer is the real trust boundary in these tests. |
| M6 Real call | One phone call produces log lines for at least 3 different tools. `trace.sh` shows the call end to end. |

## 11. Out of scope

Per-caller encrypted credentials, a session store, resources or prompts, a tool that accepts a URL or free-form JSON, and any MCP tool in a workflow tool node.

## 12. Outward actions

`ship`, `secrets add`, creating the Integration Secret, creating the MCP server record, attaching it to the assistant, and phone calls each need David's explicit request in the current session (AGENTS.md "Outward actions").

## 13. Unverified items to record when they resolve

- C-7: whether the model returns `auth_token` unchanged, and whether `pii_redaction: redact` leaves the digits and the token usable.

- C-2: which step of the SDK ladder works, and whether `_meta.telnyx_conversation_id` arrives on `tools/call`.
- C-4: whether individual MCP tools appear in a node's Tools tab.
- Auth header and scheme sent from the API Key field.
- Whether the server-level Tool timeout field works, and whether filler messages play for MCP tools. Telnyx's pages disagree on both.
