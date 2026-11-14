# Balance lookup delays the HR phone transfer after verification

Diagnosed: 2026-11-14, Asia/Tokyo. Investigator: Codex (GPT-6; a more specific runtime model ID is not exposed). Status: **unwanted tool order identified in the 07:43 call; corrected order observed in a newer 07:50 call after the saved HR prompt changed. Successful connection to a person remains unverified. No remote configuration or application change was made by this investigation.**

## Follow-up: Portal prompt change produced the intended order

During the subsequent Portal research, read-only inspection found conversation `acda819a-4457-45f9-adfd-3a11ac0a946d`, served by version `20261113T224936243181`. It recorded verification success at **07:50:16.803 JST**, the HR workflow transition at **07:50:17**, and `transfer` at **07:50:18.320**, with no balance call. A second transfer invocation occurred later; the destination connection outcome is not established by these observations.

Comparing the retained 07:43 and 07:50 call versions showed that only `hr_manager` changed among the inspected node settings. Edges, global instructions and MCP settings were unchanged. The newer HR prompt explicitly says:

> The caller is a verified employee who needs HR. Do not answer questions about leave, balances, or policies yourself. HR will help them.

It also changes the transfer instruction to **immediately** call the transfer tool. Current readback version `20261113T225131396332` retains this wording. The MCP registration is named `HR_MCP`, attached to `TeraLabs AI Assistant`, and both inspected allowlists remain null.

This supports a **Portal node-prompt correction for the observed ordering issue**, without a new backend-code change. It also narrows the earlier recommendation below: restricting MCP exposure is an optional enforcement measure for a verification-and-transfer-only assistant, not a prerequisite demonstrated by the corrected call. One successful sequence does not guarantee future model compliance.

The [new sanitized evidence](../diagnostics/2026-11-14-verification-hr-transfer-after-prompt-evidence.json) passes the existing sequence check:

```sh
python3 docs/diagnostics/check-verification-transfer.py docs/diagnostics/2026-11-14-verification-hr-transfer-after-prompt-evidence.json
```

Output: successful verification, next business tool `transfer`, node `hr_manager`, **PASS**. This validates tool order only. The [Portal research](../TELNYX_PORTAL_TRANSFER_RESEARCH.md) documents the actual supported controls: the Portal's **Allowed tools** editor is server-level; the assistant-specific override is documented in the API but its Portal UI is not established. The investigation could read account APIs after the existing CLI session refreshed, but could not inspect the live Portal UI.

## Requested behavior

David wants successful verification to be acknowledged, followed immediately by transfer to the appropriate manager. The assistant must not look up leave balance first. The saved `HR_Manager` and `Finance_Manager` prompts describe phone transfers to configured targets with those names, rather than specialist AI nodes that answer the request themselves.

This requirement supersedes the earlier recommendation to call `get_leave_balance` immediately in the verification node. That earlier recommendation followed TDD §6.1's combined N10 verification-and-balance behavior. Keep the corrected token response format; change the workflow's responsibilities for this requested transfer flow.

## Evidence from the actual call

Read-only Telnyx Conversations and Assistants API inspection found:

- Conversation: `7761fb66-0b8d-446d-88cc-e3fbdf162248`, `phone_call`.
- Assistant: `assistant-00b60205-732a-4cf3-b3c8-78871df94fec`.
- Version used by the call: `20261113T224228900441`.
- Current version at inspection: `20261113T224621268085`.
- Model: `zai-org/GLM-5.3-Flash`.
- The retained call version and current version have identical node instructions/scoping, edge definitions, global instructions, and MCP attachment/allowlist in the inspected fields.

Times below are **2026-11-14 JST**. Workflow-transition metadata has second precision; message timestamps have fractions of a second. Do not infer subsecond ordering from the rounded transition timestamp.

| Time | Recorded event |
| --- | --- |
| 07:43:18.794 | `verify_employee` called. |
| 07:43:21.288 | Verification returned `ok: true`, with a token field. |
| 07:43:21, second precision | `verify_employee -> hr_manager`, LLM edge `verify_employee_to_hr_manager`. |
| 07:43:22.104 | Verification acknowledgement, without an HR/transfer announcement. Only classification booleans were retained, not speech. |
| 07:43:22.423 | `get_leave_balance` called while the recorded active node was `hr_manager`. |
| 07:43:26.107 | Balance returned `ok: true`. |
| 07:43:39.646 | `transfer` called later while in `hr_manager`. This investigation does not establish successful connection to the destination. |

**The HR workflow edge fired before balance was queried. The later phone transfer was delayed by a balance lookup inside HR.** These are two different operations. The earlier token failure is not the cause of this call's unwanted ordering: both verification and balance succeeded here.

Evidence: [sanitized sequence](../diagnostics/2026-11-14-verification-hr-transfer-evidence.json). No caller speech, PIN, token, employee number, or tool argument/result body is retained. No new Langfuse trace was fetched and no new call was made.

## Cause and hypothesis checks

1. **HR prompt omits a transfer instruction — ruled out.** It already says: `Say one short line, such as "Sure, I'll connect you to HR now." Then call the transfer tool using only the target named "HR Manager".` Nevertheless, the model selected balance first.
2. **Verification/global prompt requires immediate balance — ruled out for this call.** Verification says: `Your only job is to verify. Never look up leave balances, policies, or any other information.` The inspected global instructions do not require balance. The verification handler in `hr-leave-assistant/src/tools.ts` returns authentication data and does not invoke the balance handler.
3. **The call used obsolete routing prompts — ruled out in the compared fields.** The version IDs differ, but the relevant instructions, edges and MCP settings match.
4. **Unrestricted MCP access permits the wrong business tool in the transfer node — confirmed as the control gap.** The assistant's MCP attachment has `allowed_tools: null`, and the referenced server also has `allowed_tools: null`. Actual runtime evidence shows `get_leave_balance` callable in HR despite its transfer instruction and `tools_mode: replace`/non-null `shared_tool_ids`.

The observed failure is model selection of an available business lookup instead of the instructed phone transfer. The precise internal reason the model preferred that tool is not established. The configuration relies on prompt compliance while leaving the unwanted action callable; removing that action from this assistant's toolset is stronger than repeating the instruction.

The wiki describes `shared_tool_ids` as node tool scoping, but also leaves individual MCP-tool scoping unverified. This call proves that the saved node settings did not exclude the balance tool. Do not interpret `tools_mode: replace` as proof that all MCP tools have been filtered.

## Concrete proposed correction

As optional enforcement for this **verification-and-phone-transfer assistant**, the existing MCP attachment's assistant-level API allowlist can be set to:

```json
{
  "id": "01f53071-2e30-4a0c-b90d-4345bc2289ec",
  "allowed_tools": ["verify_employee"]
}
```

This is the documented per-assistant MCP setting, not an invented per-node property. It excludes balance and other HR business tools throughout this assistant. Apply it only to the requested transfer flow; an assistant intended to provide automated leave services needs those tools scoped separately. Do not change the shared MCP server's global allowlist or remove its implemented tools.

In `Verify_employee`, retain collection/error handling and replace the successful-verification guidance with:

> When `verify_employee` returns `ok: true`, say "You are verified." Immediately call `transition__verify_employee_to_hr_manager` for the caller's remembered HR request, or `transition__verify_employee_to_finance_manager` for their remembered Finance request. Do not ask the caller to repeat their request or wait for another reply. Keep the token private. Your task ends with this workflow transition; leave and account lookups are outside this step.

In `HR_Manager`, make the permitted next action explicit:

> The caller has already been verified and is waiting for a phone transfer. Say "I'll connect you to the HR manager now." Immediately call the configured `transfer` tool using the target named "HR Manager". Do not answer their original HR question, retrieve leave data, or verify them again. If the transfer fails, follow the existing unavailable-team fallback.

Use the corresponding wording and configured target `Finance Manager` in `Finance_Manager`. Ensure the configured transfer tool is available in each manager node. The observed HR call already demonstrates a callable `transfer` tool; Finance was not exercised by this call.

**The existing HR edge is correctly connected and is not the primary fix.** Optional clearer HR edge prompt:

> `verify_employee` returned `ok: true`, and the caller's remembered request is for HR, leave, jobs, interviews, or another employee matter. Call this transition immediately so HR can transfer the call. No balance lookup or further caller confirmation is required.

Keep the Finance condition specific to Finance so the two edges do not overlap. Use success from the tool result, not merely the caller's claim to be verified. Do not add a default edge to the verification prompt node or assume the MCP result automatically creates a `verified` dynamic variable.

If exact acknowledgement wording must be guaranteed, use a Speak node for that sentence with its required single default edge, after selecting the successful department route. This is an optional graph refinement; it is not needed to explain the present failure.

## Reproduction and acceptance

The diagnostic checks the actual sanitized tool sequence and workflow metadata, without invoking the model or changing remote state:

```sh
python3 docs/diagnostics/check-verification-transfer.py docs/diagnostics/2026-11-14-verification-hr-transfer-evidence.json
```

Observed output, exit 1:

```text
Successful verification: yes
Next business tool: get_leave_balance
Workflow node: hr_manager
FAIL: expected manager transfer before any business lookup
```

The replay establishes the reported symptom and detects a corrected sequence in a future captured call. It does not prove that an untested prompt or allowlist change will fix the voice runtime. No application test can verify the external model's tool selection by asserting prompt text alone.

After authorized configuration changes, verify a synthetic HR call records `verify_employee` success, the HR workflow transition, then `transfer`, with no balance lookup. Verify the acknowledgement is audible and the configured destination is actually attempted. Repeat the appropriate route for Finance, and a failed verification that must not reach either manager. Respect the existing C-8 tracing restrictions when arranging that verification.

## Sources consulted

- `Telynyx/index.md`, `telnyx-docs-hub`, `telnyx-build-reading-list`, `telnyx-gotchas-all`.
- `assistants-workflow-nodes`, `assistants-workflow-edges-and-routing`, `assistants-tools-library`.
- Endpoint pages: `api-assistants-get-an-assistant`, `api-assistants-get-a-specific-assistant-version`, `api-conversations-list-conversations`, `api-conversations-get-conversation-messages`, `api-mcp-servers-get-mcp-server`.
- TDD §3, §6, §7.1, §9, §10.1/§10.5; `docs/MCP_SERVER_SPEC.md`; current `hr-leave-assistant/src/tools.ts`.

On voice calls, LLM edges are transition tools. Saying "the next step takes over" is less explicit than directing the transition call, but it did not prevent the recorded HR transition. The evidence supports fixing manager tool access and action priority before attributing the fault to the edges.
