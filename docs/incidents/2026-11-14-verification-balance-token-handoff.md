# Verified employee cannot retrieve leave balance

Diagnosed: 2026-11-14, Asia/Tokyo. Investigator: Codex (GPT-6; a more specific runtime model identifier is not exposed). Source examined: `4754c0e8b99414a32525024f783285829b4ddc54`. Status: **root cause established; proposed response change verified locally in an isolated copy; application and portal not modified**.

Updated on 2026-11-14 with two Langfuse screenshots supplied by David. The newer trace shows the welcome greeting substituted for the token; the original call below substituted the employee number. Both demonstrate the same incorrect credential handoff. No new deployment or voice-call acceptance test was performed for this document update.

Later follow-up on 2026-11-14: [verification-to-HR transfer investigation](2026-11-14-verification-hr-transfer-routing.md) found a newer call in which both verification and balance succeeded. Its remaining issue is unwanted balance lookup before the HR phone transfer, after the workflow had already entered `hr_manager`. David now wants verification followed immediately by manager transfer. For that flow, the immediate-balance recommendation below is superseded by the follow-up; preserve the token-response correction, but do not add an automatic balance query to verification.

## Symptom and evidence

The phone assistant successfully verifies the employee, then repeatedly asks them to sign in instead of returning leave balance. The affected conversation was found independently through read-only Edge logs and the Conversations API; the user did not need to supply a call ID.

- Conversation: `37032a37-f039-4dba-9d7d-8b2d4402ea8b`, channel `phone_call`.
- Assistant: `assistant-00b60205-732a-4cf3-b3c8-78871df94fec`.
- Assistant version used by the call and returned by current readback: `20261113T125228844133`; model `zai-org/GLM-5.3-Flash`.
- Call occurred on 2026-11-13 around **22:37 JST** (13:37 UTC).
- Three `verify_employee` completions have `outcome: verified`. All five `get_leave_balance` completions have `outcome: unauthenticated`, with no employee pseudonym or actor timing on the rejected balance requests.

First pair, retaining only approved log fields:

```json
{"ts":"2026-11-13T13:37:30.785Z","conversation_id":"37032a37-f039-4dba-9d7d-8b2d4402ea8b","tool":"verify_employee","outcome":"verified","status":200,"actor_ms":609}
{"ts":"2026-11-13T13:37:33.276Z","conversation_id":"37032a37-f039-4dba-9d7d-8b2d4402ea8b","tool":"get_leave_balance","outcome":"unauthenticated","status":200}
```

The HTTP 200 transports an MCP tool result; it does **not** mean the balance operation succeeded. Inspect `structuredContent.ok`, its error code, and `isError`.

The conversation's tool-call arguments were compared in memory, with only lengths, format checks and equality booleans retained:

| Check | Observed result |
| --- | --- |
| Verification tool results in conversation history | Three plain-text greetings, each 14 characters; no `auth_token` field or signed session token |
| Balance `auth_token` argument | Four characters on all five attempts |
| Matches required signed-token format | False on all five |
| Equals the preceding verification's employee number | True on all five |
| Equals the preceding verification's PIN | False on all five |
| Contains a stored-redaction marker | False on all five |
| Conversation ID changes between these server requests | No |

The assistant privacy readback obtained during the initial investigation was `pii_redaction: disabled`, so redaction is not an explanation for these four-character argument values. This is also a configuration discrepancy from TDD §6.4/§9, separate from the cause of this failure. No raw caller speech, PIN, employee number, token, or tool body is retained in this incident or its [sanitized evidence](../diagnostics/2026-11-14-verification-balance-evidence.json).

### Additional evidence: greeting supplied as the token

David supplied `Screenshot 2026-11-14 at 7.00.24.png` and `Screenshot 2026-11-14 at 7.01.21.png`. Both show Langfuse trace **`0cfdc0df399109865be3a8f76dd4b2c9`**. The displayed tool timestamps are on 2026-11-14; the screenshots do not show the UI timezone or the conversation ID. This trace is recorded separately from the earlier conversation, without assuming an identifier mapping or an unchanged deployment/configuration.

| Observation | Screenshot evidence | Interpretation |
| --- | --- | --- |
| `verify_employee`, displayed time `06:55:57.505`, duration `2.46s` | `structuredContent.ok` is `True`; `structuredContent.data.auth_token` contains a token in the expected signed-token format; `content[0].text` contains the welcome greeting. | Verification returned the credential. Its presence in this output is expected. The screenshot alone does not independently validate its signature. |
| `get_leave_balance`, displayed time `06:56:00.348`, duration `1.69s` | The **input** field `auth_token` contains the welcome greeting instead of the issued token. | The wrong value was forwarded to the balance tool. |
| Balance result | `structuredContent.ok` is `False`, `code` is `unauthenticated`, and `isError` is `True`. | Authentication is rejected before the balance can be returned. |

The actual name, employee number, PIN and token visible in the screenshots are intentionally not transcribed or embedded here.

**The balance tool needs the token in its input; its output does not need to return a token.** On success, that output should contain entitlement, used days, remaining days and upcoming leave. The required data flow is:

```ts
// Conceptual field mapping, not automatic Portal variable assignment.
get_leave_balance({
  auth_token: verificationResult.structuredContent.data.auth_token,
});
```

The screenshot's input instead matches `verificationResult.content[0].text`. This establishes the incorrect value, not the internal code path that selected it. Seeing the complete MCP response in a Langfuse tool observation does **not** establish which representation was passed to the model: Telnyx may expose only text to that consumer, or the model may select the wrong field despite receiving more context. Inspecting the corresponding generation input would be needed to distinguish those explanations. The failed argument handoff itself is directly visible in both cases.

### Separate finding: credentials are visible in Langfuse

The verification screenshot displays the PIN in the traced input and the session token in the traced output. This is observed credential exposure, not merely a hypothetical risk. The no-PIN acceptance condition in TDD §13 C-8 is not met by this trace, and TDD §9/§10.5 treats Langfuse as a log.

The newer screenshots do not establish whether `pii_redaction: redact` was enabled for that call; they therefore do not prove that redaction failed while enabled. Keep assistant tracing disabled except for calls using throwaway synthetic PINs until C-8 is rerun with the intended settings and confirms no PIN exposure. Retain no raw credentials in incident evidence. Any remote setting change requires a separate authorized action and was not performed for this update.

The screenshots also establish that these MCP tool observations are present in this Langfuse trace. They do not identify the exporting component or establish MCP tracing behavior for every account/client. The earlier Edge log field `trace: off` describes the function's own exporter and does not rule out a separate assistant-side or other trace exporter.

## Root cause

**The issued authentication credential is not forwarded at the verification-to-balance handoff. The balance tool receives an employee number in the original call and a welcome greeting in the newer screenshot evidence, instead of the signed `auth_token`.** The balance handler correctly rejects these values before reading any leave data.

The relevant code path is:

1. [`handleVerifyEmployee`](../../hr-leave-assistant/src/tools.ts) creates the signed token at lines 173–178 and passes `{ auth_token, first_name }` into `toolSuccess` at lines 180–183.
2. `toolSuccess` at lines 70–74 places that data **only in `structuredContent`**. Its `content[0].text` contains only the greeting.
3. In the original conversation history, the recorded verification tool message contains the greeting alone, and the next balance arguments contain the employee number. The newer Langfuse tool observation shows both response fields, but the next balance request uses the greeting. The helper supplies no serialized token in its text block, creating the compatibility gap reproduced locally.
4. [`verifySessionToken`](../../hr-leave-assistant/src/lib/auth.ts), lines 85–87, splits the argument on dots and requires four parts beginning with `v1`. Both an employee number and a welcome greeting fail immediately, **before HMAC, expiry, or conversation-binding checks**.
5. `get_leave_balance` returns `unauthenticated` at `tools.ts:245–247`; `EmployeeLeave.summary()` at line 261 is never reached.

This is a concrete argument-handoff failure with a reproducible result-format compatibility gap. Neither the original evidence nor the newer screenshots prove that Telnyx discarded `structuredContent` from the live model context: the public documentation does not specify that internal projection. The observed wrong arguments, matching server errors and local reproduction establish the failure without making that broader claim.

The MCP specification explicitly recommends that structured results also include serialized JSON in a `TextContent` block for compatibility. Our helper omits that representation. [MCP structured content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content)

## Prompt contribution and alternatives checked

The real saved graph has a prompt node named `Verify_employee`, not the TDD's complete N10 implementation. Its instructions say to call `verify_employee`, announce verification, and “Keep the auth token from the tool result for the next steps.” They do not explicitly name `data.auth_token`, require exact copying, or instruct an immediate `get_leave_balance` call. The balance tool description says only “Requires an auth_token.” Strengthening those instructions is useful, but cannot recover a token absent from the result representation the model uses.

Hypotheses evaluated:

1. **Missing token in text result / wrong argument relay:** supported by the original transcript shape, all five employee-number substitutions, the newer greeting-as-token screenshot, and the red/green compatibility test. The exact Telnyx-to-model projection remains unverified.
2. **Incomplete prompt handoff:** confirmed in saved instructions; a contributing reliability issue, not a reason to weaken backend validation.
3. **Old binding mismatch:** current source passes the same conversation ID to creation and verification. The malformed four-character value fails before binding is inspected. The earlier binding fix in `4754c0e` does not fix this separate handoff defect.
4. **Missing balance tool, bad actor data, or balance-query error:** the balance tool was actually called five times and returned an auth refusal. A preceding direct test (`conv_e2e_001`, 13:34:35–39 UTC) logged `verified` then `ok`; local real-handler/real-actor tests also return the correct balance with the issued token.
5. **Token expiry/redaction:** the first refusal follows verification within approximately 2.5 seconds; current tokens last 15 minutes. The argument is not a signed token at all, and the inspected assistant version has redaction disabled.

The original log's `node: N10` is derived from the tool name in `mcp.ts`; it is not proof that the active portal workflow node was named N10. `call_ref` is `none`, the function's tracing is `off`, and no deployment revision is recorded in those lines. The initial investigation therefore uses the real `conversation_id` and does not claim a retrieved Langfuse trace or exact deployed source revision for that old call. The later, separately identified Langfuse trace is supported by David's screenshots above.

## Proposed solution

First, expose the complete small success envelope in **one** MCP text block while retaining `structuredContent`. The single-expression change tested in the isolated copy was:

```ts
function toolSuccess<T>(text: string, data: T): CallToolResult {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ ok: true, data, message: text }),
    }],
    structuredContent: { ok: true as const, data },
  };
}
```

This keeps the greeting as `message` and makes `data.auth_token` available to a client that consumes text. Apply the same envelope principle to errors when implementing, so the model also receives machine-readable error codes; error serialization was not needed for the tested success-path fix.

Second, append concrete handoff instructions to the actual verification node, and reflect them in the tool descriptions:

> After `verify_employee` succeeds, read `data.auth_token` from its JSON result. Pass that exact string unchanged as `auth_token` to `get_leave_balance` immediately. Never substitute the welcome greeting, the full response object, an employee number or PIN. Never invent a token, shorten it, or say it aloud. If the result contains no token, treat verification as a tool failure and use the existing fallback. Read the remaining days only after `get_leave_balance` succeeds. Complete that lookup before transitioning onward. If balance returns `unauthenticated`, verify once more; after another failure use the existing HR fallback rather than repeating indefinitely.

Keep signature, expiry, and conversation binding intact. Do not accept employee numbers as tokens. Do not add `{{auth_token}}` expecting automatic MCP-result assignment: Telnyx documents explicit mappings for webhook tools, not automatic assignment from an MCP result. If exact copying remains unreliable after the compatibility fix, evaluate the conversation-keyed actor-session fallback already described in TDD §7.1/C-7 as a separate change.

The token remains an internal tool credential: do not speak or log it. During implementation restore the planned privacy setting and repeat C-7/C-8 with synthetic data before enabling tracing for real calls. Existing Edge logs and custom spans must remain allowlisted.

## Reproduction and validation

The diagnostic harness calls the real `handleMcp`, MCP SDK transport, signing/verification code and `EmployeeLeave` methods. Only platform secret/KV bindings and actor storage are replaced with deterministic in-memory fixtures. It emits no tokens or PINs.

From `hr-leave-assistant/`:

```sh
./node_modules/.bin/vitest run --config ../docs/diagnostics/vitest.config.mjs
```

On unchanged application source: **3 passed, 1 failed**, reproduced twice during diagnosis (initial harness: 2 passed, 1 failed before adding the captured-input case). The failing test is `supplies the issued token through MCP text content and completes the balance lookup`.

The three passing controls prove that:

- An unchanged issued token returns 8 remaining days from the real actor fixture (14 entitlement, 6 used).
- A token bound to a different conversation remains unauthenticated and never calls `summary`.
- Substituting the employee number reproduces the observed `unauthenticated` refusal before `summary`.

A copy of `src/` under `/private/tmp/hr-balance-proposed-fix-sl4mr05r` changes only the success text expression shown above. Running the same four diagnostics against that copy yields **4 passed**, including the text-to-token-to-balance chain. This is a local compatibility proof, not a new Telnyx voice-call test. Those counts predate the screenshots; no new greeting-as-token test was added or run during this document-only update.

The unchanged application suite also passes **56 tests across 9 files**, and typechecking passes. Existing verification tests inspect `structuredContent` directly and do not cover the text representation consumed at the next tool handoff; that explains the coverage gap.

Final deployed acceptance, after implementation is requested: a synthetic phone call must show `verify_employee → verified`, then `get_leave_balance → ok` for the same conversation, correct spoken remaining days, and no token spoken or logged. Confirm invalid tokens still fail. No deployment, assistant update, employee reset, new call or live tool invocation was performed during this diagnosis.

## Documentation consulted

Full primary-source research and wiki inventory: [TELNYX_VERIFICATION_BALANCE_RESEARCH.md](../TELNYX_VERIFICATION_BALANCE_RESEARCH.md).

- [Telnyx MCP setup and tool-use guidance](https://developers.telnyx.com/docs/development/mcp/assistant-mcp-servers.md).
- [Telnyx workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows.md).
- [MCP metadata](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant.md#model-context-protocol-mcp-servers).
- [Assistant schema and privacy semantics](https://developers.telnyx.com/api-reference/assistants/update-an-assistant.md).
- [Conversation messages API](https://developers.telnyx.com/api-reference/conversations/get-conversation-messages.md), including tool calls.
- [MCP structured-content compatibility](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content).
- [Telnyx agent observability](https://developers.telnyx.com/docs/inference/ai-assistants/agent-observability.md); for the screenshot update, read through `Telynyx/wiki/telnyx/assistants/assistants-agent-observability-langfuse.md`, alongside TDD §9, §10.5 and C-8. The screenshots are account evidence; the wiki is documentation, not proof of this trace's exporter or settings.

Read-only log retrieval initially failed because sandbox DNS blocked `api.telnyx.com`; retry outside the sandbox succeeded. Current account evidence above takes precedence over the TDD's intended graph and the earlier DEVLOG's direct-test completion claim.
