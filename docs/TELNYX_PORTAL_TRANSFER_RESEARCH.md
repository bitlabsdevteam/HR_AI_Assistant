# Portal-only verification followed by phone transfer

Research date: 2026-11-14 (JST). Research agent: Codex (exact runtime model ID not exposed to this research agent). Scope: documentation research and proposed Portal configuration only. No account setting, deployed application, call, assistant, MCP server, or transfer destination was changed by this research.

## Finding

**The newer observed call already followed the desired tool sequence: verification → HR transition → Transfer, with no balance lookup.** Retain the strengthened HR prompt and existing successful routing edges. The earlier unwanted lookup is evidence of the previous behavior, not the latest observed outcome. The newer call establishes tool selection, not successful connection to a human; Transfer was invoked again several seconds later, and the reason/result is not established by this research. [Account evidence below]

For an assistant whose entire job is **verify the caller, then transfer to HR or Finance**, narrowing the MCP server's **Allowed tools** to `verify_employee` is an optional stronger control against future balance lookups. It is not a necessary explanation for the latest improvement: both relevant allowlists were still null. The Portal guide says this selection limits tools exposed to the assistant, whereas prompts direct selection from the tools available. [Account evidence below; S1, S2]

For this account, **keep the existing prompt nodes, successful verification edges, and configured Transfer targets**. Telnyx also documents deterministic Transfer tool nodes, but the public documentation does not explain how a tool node selects HR versus Finance from an existing Transfer tool with multiple named targets. Treat that as an optional later improvement requiring Portal verification. A node named `HR_Manager` does not itself place a phone transfer. [S2, S4]

The API supports `mcp_servers[].allowed_tools` as a **per-assistant** override. The Portal guide documents an account-level server editor and an assistant-level attachment area, but does not explicitly document a separate per-assistant override editor. These are different controls; any earlier recommendation that described the documented Portal server selector as an assistant-only override conflated them. Do not tell the user to operate an assistant-only override editor without seeing it in the Portal. [S1, S3]

## Existing account evidence supplied to this investigation

The directing agent supplied the following sanitized observations from its account investigation; this research agent did not independently fetch the account records. The later observations supersede a conclusion based only on the first call.

### Earlier call: unwanted balance lookup

- Conversation `7761fb66-0b8d-446d-88cc-e3fbdf162248`, approximately 2026-11-14 07:43 JST, used assistant version `20261113T224228900441`.
- Successful `verify_employee` was followed by the actual workflow edge `verify_employee_to_hr_manager`.
- `get_leave_balance` then succeeded while the conversation was in `hr_manager`; the phone-transfer tool was invoked later.
- Relevant retained-version and current instructions matched: verification instructed verification only; HR instructed immediate transfer.
- The MCP server and assistant attachment had `allowed_tools: null`.

This earlier evidence locates the unwanted lookup **after the successful routing edge**, in the HR prompt step. It does not support blaming an absent verification transition. The older instruction to transfer immediately did not prevent an available balance tool from being called. The public MCP schema does not explain every null/empty-list combination; the successful lookup directly establishes that the older configuration did not exclude `get_leave_balance`. [Account evidence above; S3, S8]

### Newer call: desired selection order already observed

- Assistant: **TeraLabs AI Assistant**. Current configuration at the refreshed read: version `20261113T225131396332`; attached MCP configuration **HR_MCP**. Both MCP server and assistant-attachment allowlists remained null.
- The current HR prompt says: “The caller is a verified employee who needs HR. Do not answer questions about leave, balances, or policies yourself. HR will help them.” It then directs immediate Transfer. This is stronger task guidance than the earlier immediate-transfer-only instruction.
- Newer conversation `acda819a-4457-45f9-adfd-3a11ac0a946d` used version `20261113T224936243181`.
- On 2026-11-14 (JST), successful verification appeared at **07:50:16.802**, the HR transition at **07:50:17**, and Transfer at **07:50:18.319**. There was **no `get_leave_balance` invocation** in this observed sequence.
- Another Transfer invocation appeared at approximately **07:50:23**. Inspection of the returned Transfer content did not identify a recognizable outcome. The evidence therefore does not establish why it repeated, whether the first attempt failed, or whether either invocation connected the caller to a human.
- The directing agent compared retained versions `20261113T224228900441` and `20261113T224936243181`: **only `hr_manager` changed**. Edges, global instructions, MCP attachment, and server allowlists were identical. The newer call then selected Transfer as its next substantive tool after verification/routing.

The retained-version comparison and newer call provide strong one-call evidence that the HR prompt change improved tool selection while MCP tools remained unrestricted. Therefore, retain the improved prompt; do not present an allowlist change as a prerequisite for fixing a sequence already observed to improve. One successful selection sequence does not establish a guarantee across calls, and tool invocation alone does not prove physical connection. [Account evidence above]

No PIN, employee number, token, caller speech, raw phone number, or credential is recorded here.

## What each control actually scopes

| Control | Documented scope and behavior | What is not established |
| --- | --- | --- |
| **Tools → MCP Servers → Allowed tools** | Saved on the MCP server configuration. The guide says select only needed tools, leave unrelated tools unselected, and Save. [S1] | Exact semantics of all-null versus empty-list values are not explained by the public schema. [S8] |
| **Assistant → Integrations → MCP Servers** | Attach an existing server; review its Allowed tools; play discovers tools; edit/remove controls are shown. Account-level creation does not attach a server automatically. [S1] | The guide does not say the attachment's edit action writes an assistant-only override rather than editing the shared server configuration. |
| **`mcp_servers[].allowed_tools`** | API-supported array of MCP tool names; when omitted, the assistant uses the server's configured `allowed_tools`. [S3] | A Portal UI for this exact field; whether an explicit list can expand beyond a server-level list; treatment of explicit null on input. |
| **Workflow prompt node → Tools → Inherited tools** | Each inherited tool is on by default and can be toggled for the node. The documented example toggles Transfer, a webhook, and Hang Up. [S2] | Individual MCP tool toggles, a whole-MCP-server toggle, or whether these node controls filter independently attached MCP tools. |
| **`shared_tool_ids` / `tools_mode`** | Node API uses IDs of shared organization tools. `replace` means only node tools; `append` adds them to assistant tools; `tools_mode` is ignored when `shared_tool_ids` is null. [S3] | That MCP tool names can be placed in `shared_tool_ids`, or that this field is a documented MCP allowlist. No such mapping is given. |
| **Transfer tool** | Transfers the telephone call to one of the configured named targets. Target config has `name` and destination `to` (phone number or SIP URI). [S3, S4] | A workflow node label alone is not a transfer target or telephone action. |
| **Transfer tool node** | Shared-library tool; executes on entry with no model turn. At most one default edge, taken only if transfer fails. [S2] | Exact Portal configuration/runtime argument used to select one named target among multiple destinations. |

The practical distinction is **tool exposure versus instructions**. The Portal's allowed-tool selector changes what is available; a prompt tells the model how to use the tools that remain available. The guide explicitly recommends both. [S1]

## Recommended Portal follow-up and optional enforcement

**Immediate recommendation:** retain the strengthened HR prompt, the existing HR/Finance Transfer targets, and the routing edges that already fired correctly. Check the repeated Transfer results and confirm actual destination connection before claiming the entire phone-transfer goal is complete. The live Portal was unavailable to the directing agent, so the click paths below remain documentation-backed. [Account evidence above; S1, S2, S4]

**Optional enforcement if this assistant should only verify and transfer:** use the following Portal steps to remove leave-data tools from its effective MCP exposure. These actions were not performed during this research; they are not required to explain the latest observed improvement.

1. Open **AI Assistants → Tools → MCP Servers** (`https://portal.telnyx.com/#/ai/mcp-servers`) and locate **HR_MCP**. Its use by other assistants has not been established: the account list query was inconclusive, so do not assume it is dedicated. If confirmed dedicated to this front desk, edit its **Allowed tools** to select only `verify_employee` and Save. `get_leave_balance` and the other leave tools should be unselected for a verification-and-transfer-only assistant. This is the documented Portal tool-exposure control. [Account evidence; S1]
2. If other assistants need the existing registration's broader tools, the proposed Portal-only fallback is **Create MCP Server** with a distinct descriptive name, the **same deployed MCP URL**, matching transport, and the **same existing Integration Secret reference**; choose only `verify_employee` under **Allowed tools** and Save. This creates a separate Telnyx configuration record, not another backend or deployment. The docs support these fields and this registration model but do not expressly guarantee that two records may use the same URL; account acceptance remains unverified. [S1, S9]
3. Open **TeraLabs AI Assistant → Integrations → MCP Servers**. If using the separate registration, **Add MCP server**, select the restricted registration, and remove the old **HR_MCP** attachment from **this assistant**. Keep the original server record for any other users of it. Otherwise, confirm the existing attachment's displayed **Allowed tools** matches the restricted set. If an assistant-specific edit UI exists, verify its scope before describing it as an override. An omitted assistant override inherits the server setting. [Account evidence; S1, S3]
4. In **Workflow**, keep verification as a prompt node using `verify_employee`. Keep successful-verification routing separate from the real phone-transfer action. On voice calls, LLM edges are `transition__<edge_id>` tools; successful verification does not automatically fire an LLM edge. Explicitly direct the appropriate transition tool when verification succeeds. [S2]
5. Open **HR_Manager** and **Finance_Manager**. Inspect **Tools → Inherited tools** and disable unrelated tools that actually appear there; leave the configured Transfer capability available. If individual MCP entries appear, record that observed capability before relying on it. The docs alone do not promise those MCP entries. [S2]
6. Keep the receiving prompt narrowly focused on invoking the existing **Transfer** tool with the corresponding **configured named target**. A successful workflow transition into a manager node is not the telephone transfer. [S2, S4]
7. Save the assistant, reopen it, and verify persistence. Confirm which version live calls will receive in the version/deployment controls and **Traffic distribution**. A saved candidate and a version receiving calls are different facts. [S1, S6]

**Scope caveat:** editing the account-level MCP server changes the configuration other attached assistants inherit; an explicit assistant override is a separate API field. The narrow setting must cover the assistant's effective attachment: leaving the old unrestricted registration attached as well would not establish that balance access has been removed. The create schema puts no uniqueness constraint on `url`, but absence of a published constraint is not proof that a duplicate-endpoint registration will save on this account. [S1, S3, S9]

### Prompt guidance if a corresponding node still needs updating

Retain the already strengthened HR prompt. The examples below are proposed guidance for any corresponding node that still needs it, not replacements required for the working observed sequence or Telnyx-required exact strings. Preserve existing verification failure/lockout handling and the exact target names shown by the existing Transfer tool.

For verification success:

> After `verify_employee` returns `ok: true`, call the workflow transition tool for the caller's selected HR or Finance destination immediately. Verification is complete; proceed to the transfer step. Workflow transition tools are permitted in this step. Do not speak the PIN or the authentication token.

For HR:

> Say, “You’re verified. I’ll connect you to HR now.” Then immediately invoke the configured Transfer tool using its HR target. If the transfer fails, explain that the connection failed and follow the existing fallback.

Use the same construction with the configured Finance target in Finance. Do not invent a tool-call argument such as `target_name`: the public configuration schema names `targets[].name` and `targets[].to`, but does not establish the runtime function's exact selector argument in these sources. [S3, S4]

Avoid broad “never call tools” or “the call moves by itself” wording. Telnyx warns that even “do not use the transfer tool” can inadvertently suppress the workflow's transition tool on calls. Direct the action positively and remove unwanted tools through configuration. [S2]

## Deterministic Transfer node: stronger execution, remaining setup question

The documented alternative is:

```text
verify_employee prompt
  → successful-verification edge for the selected department
  → Transfer tool node, with optional fixed announcement
  → existing fallback only if transfer fails
```

This removes the extra **model turn at the transfer step**. It does not make the preceding prompt-node verification or its LLM routing edge deterministic. [S2]

The documented construction is **Workflow → Add Node → Tool node**, then select a shared tool in the node editor. A tool node uses `shared_tool_id`; it does not accept instructions/model settings. Its optional **message** is spoken immediately before execution, with no additional customer turn. Transfer can have one default failure edge or none. [S2, S3]

Before recommending this as an immediately usable HR/Finance fix, the current Portal must answer:

- Does the existing Transfer tool exist in the **Tools Library**, or only inline on the assistant? Tool nodes reference shared tools. The library supports Transfer, and existing inline tools continue working; migrating to the library is optional in general but a shared tool is required for this node mechanism. [S2, S5]
- How does each tool node bind the intended destination? Generic arguments are supplied by conversation dynamic variables whose names match the tool's runtime parameters. The docs give no exact Transfer selector parameter or Portal per-node target dropdown. Do not assume a manager node's name supplies the destination. [S2, S3]
- If considering multiple transfer tools, how does the Portal handle them? Telnyx allows at most one Transfer instance attached at assistant level, counting inline `tools` plus library `tool_ids`. Do not casually attach two library Transfer tools alongside the current inline one. The sources do not settle the separate question of two node-local references. [S5]

There is also no documentation here that an MCP `verify_employee` tool can be selected directly as a deterministic tool node. The current project MCP spec explicitly restricts MCP execution to prompt nodes for that reason. Keep verification as-is; this research concerns the built-in Transfer action after it. [S2, S3; `docs/MCP_SERVER_SPEC.md` §3]

## Saving, publishing, and proving the result

The MCP Portal guide says **Save**, reopen the assistant, and confirm instructions and attachment remain. The version guide separately documents **Save as New Version**, names/notes, and live traffic routing. Each saved change creates a version; live calls follow the first matching traffic rule, otherwise main unless a custom default exists. This means testing only a newly opened editor or the latest saved version is insufficient to establish the behavior of the version serving the phone number. [S1, S6]

The promotion API describes promoting a version to main as sending all production traffic to it and removing an existing canary deployment. The research does not establish that the live Portal's button is literally labelled “Publish”; use its observed label and inspect the resulting main/routing state. [S7]

A future authorized verification should confirm the observed selection order and additionally prove connection, for one new synthetic-PIN call:

1. The call served the intended assistant version.
2. Successful `verify_employee`.
3. The intended HR/Finance transition.
4. The actual Transfer invocation and successful destination connection.
5. **No `get_leave_balance` invocation between verification and transfer.**

A wrong-PIN case must retain verification failure behavior, and a transfer-failure case must reach the existing fallback. The newer call already shows items 2, 3, and 5 and a Transfer invocation; it does not yet establish the successful destination connection in item 4. No calls were placed for this documentation investigation. The MCP play button discovers tools; Telnyx explicitly says it does not prove execution. Conversation History plus server logs provides the relevant evidence. [Account evidence above; S1, S2]

## Live Portal observations

No live Portal controls were verified in this session. The directing agent reported that browser inventory returned no available browser with a host-unavailable error, and native Chrome access timed out twice. A read-only account API request initially returned 401, but the directing agent refreshed OAuth through an approved read-only CLI command and account reads then worked, producing the newer evidence above. API access is therefore available again; Portal UI access remains unavailable. The account reads do not establish that a specific current Portal control or save behavior was observed. All click paths above are documentation-backed proposals.

## Source register

The official public pages below were fetched again on 2026-11-14. Guide pages S1, S2, S4, S5, and S6 were byte-identical to the 2026-11-11 repository mirrors. S3's current API page differed only by removal of the unrelated Fine Tuning tag; its relevant schemas were unchanged. Sources are primary Telnyx documentation, not third-party commentary. Repository paths identify durable local copies; `/private/tmp` downloads were used only for freshness checks.

| ID | Official primary source | Local primary-source mirror and relevant portion |
| --- | --- | --- |
| S1 | [Add MCP servers to an AI assistant](https://developers.telnyx.com/docs/development/mcp/assistant-mcp-servers.md) | [`assistant-mcp-servers.md`](../Telynyx/raw/assets/telnyx-docs/docs/development/mcp/assistant-mcp-servers.md), §§2, 5–9; lines 59, 105, 120, 142, 166 onward |
| S2 | [Conversation Workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows.md) | [`workflows.md`](../Telynyx/raw/assets/telnyx-docs/docs/inference/ai-assistants/workflows.md), node types/execution/tool availability (lines 77–157), LLM conditions (lines 192–218), default conditions (lines 252–269), assistant targets (line 445 onward) |
| S3 | [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant.md) | [`update-an-assistant.md`](../Telynyx/raw/assets/telnyx-docs/api-reference/assistants/update-an-assistant.md), `AssistantMCPServer` (line 965), `FlowNodeReq` (line 3851), `ToolNodeReq` (line 3981), `InferenceEmbeddingTransferToolParams` (line 4528) |
| S4 | [Voice Assistant Quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant.md) | [`no-code-voice-assistant.md`](../Telynyx/raw/assets/telnyx-docs/docs/inference/ai-assistants/no-code-voice-assistant.md), Transfer and SIP Refer (lines 396–402); MCP (lines 414 onward) |
| S5 | [Tools Library](https://developers.telnyx.com/docs/inference/ai-assistants/tools-library.md) | [`tools-library.md`](../Telynyx/raw/assets/telnyx-docs/docs/inference/ai-assistants/tools-library.md), supported types, Getting started, Updating assistants with library tools |
| S6 | [Testing and Traffic Distribution](https://developers.telnyx.com/docs/inference/ai-assistants/version-testing-traffic-distribution.md) | [`version-testing-traffic-distribution.md`](../Telynyx/raw/assets/telnyx-docs/docs/inference/ai-assistants/version-testing-traffic-distribution.md), Creating a New Version, Version retention, Production Traffic Distribution |
| S7 | [Promote an assistant version to main](https://developers.telnyx.com/api-reference/assistants/promote-an-assistant-version-to-main.md) | [`promote-an-assistant-version-to-main.md`](../Telynyx/raw/assets/telnyx-docs/api-reference/assistants/promote-an-assistant-version-to-main.md), endpoint description (lines 5–7, 54–58) |
| S8 | [Update MCP Server](https://developers.telnyx.com/api-reference/mcp-servers/update-mcp-server.md) | [`update-mcp-server.md`](../Telynyx/raw/assets/telnyx-docs/api-reference/mcp-servers/update-mcp-server.md), `UpdateMCPServerRequest.allowed_tools` and `MCPServer.allowed_tools` |
| S9 | [Create MCP Server](https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server.md) | [`create-mcp-server.md`](../Telynyx/raw/assets/telnyx-docs/api-reference/mcp-servers/create-mcp-server.md), endpoint description and `CreateMCPServerRequest` (line 254); required `name`, `type`, `url`, optional `api_key_ref`, `allowed_tools` |

## Required repository reading

Read before the investigation: `AGENTS.md`; `.agents/skills/research/SKILL.md`; `Telynyx/index.md`; `Telynyx/wiki/telnyx-docs-hub.md`; `Telynyx/wiki/telnyx-build-reading-list.md`; the relevant assistants/development sections of `Telynyx/wiki/telnyx-gotchas-all.md`; `docs/TDD.md` §§3, 6, 7, 13; `docs/MCP_SERVER_SPEC.md` §§0–6.

Exact feature wiki pages followed to the primary sources: `development-mcp-assistant-mcp-servers`; `assistants-workflow-nodes`; `assistants-workflow-edges-and-routing`; `assistants-workflow-api-schema`; `assistants-tools-library`; `assistants-version-testing-traffic-distribution`; endpoint pages `api-assistants-update-an-assistant`, `api-mcp-servers-update-mcp-server`, and `api-mcp-servers-create-mcp-server`. The wiki was not edited.
