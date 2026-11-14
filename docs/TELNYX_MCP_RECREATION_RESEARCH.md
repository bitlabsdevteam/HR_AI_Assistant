# Removing and recreating a Telnyx MCP server

Research date: **2026-11-13**. Scope: an AI Assistant's custom MCP configuration in Mission Control Portal. Sources are current Telnyx developer pages, their screenshots, and the repository's first-party documentation mirror. No account configuration was changed. **The account-level portal delete control remains unverified**: live browser access was unavailable and native inspection was denied.

## Remove the old configuration

1. Open [AI Assistants](https://portal.telnyx.com/#/ai/assistants), select the assistant, then **Integrations → MCP Servers**. The official screenshot shows play, edit, and trash/remove controls on each attached server. Remove the old attachment and **Save** the assistant. This removes the assistant's attachment; account-level server management is a separate page. Reopen the assistant to check the saved state. [1]
2. Open [AI Assistants → Tools → MCP Servers](https://portal.telnyx.com/#/ai/mcp-servers). Telnyx documents this as the configuration-management page, but its published list screenshot shows only an edit pencil. Neither the guide nor its screenshots establish where a permanent **Delete** action is located or what its confirmation dialog says. Do not treat the assistant's trash control as evidence of account-level deletion. [1]
3. The confirmed permanent-deletion operation is `DELETE https://api.telnyx.com/v2/ai/mcp_servers/{mcp_server_id}`. Success is **204 No Content**. This deletes the registered server configuration. [2]

Deletion returns **400**, Telnyx error **10015**, while an active assistant references the server. **Retained assistant version snapshots count**, even when the current assistant no longer lists it. The error's `detail` names blocking assistants and their IDs. Telnyx's prescribed resolution is to remove the live reference, delete retained versions that still reference the server, then retry. [2][3]

For version cleanup, the documented API routes are:

| Operation | Method and path, under `https://api.telnyx.com/v2` |
| --- | --- |
| Inspect complete retained configurations | `GET /ai/assistants/{assistant_id}/versions` |
| Delete one retained version | `DELETE /ai/assistants/{assistant_id}/versions/{version_id}` |

Version deletion is permanent, returns **204**, and **cannot delete the main version**. Inspect each version's `mcp_servers` references first. Every assistant save creates a version; ordinary retention keeps up to ten, while main and versions referenced by traffic-distribution rules are exempt from automatic deletion. Traffic rules can still serve an older version. The sources do **not** establish what manual deletion does to a traffic-referenced version or where the portal's version-delete control is located. [4][5][6]

## Register and attach the replacement

The following portal flow is explicitly documented, with screenshots. [1]

1. On **AI Assistants → Tools → MCP Servers**, select **Create MCP Server**.
2. Enter **Name**, **Type** (**HTTP** or **SSE**), and **URL**. Use the MCP endpoint itself. For this project, the design specifies **HTTP** and the existing Edge function's `/mcp` route. **Tool timeout (ms)** is an optional portal field. [1][9]
3. In **API Key**, select the existing **Integration Secret identifier** holding the MCP service credential. The identifier is a reference, not the secret value. If a replacement secret is needed, [Integration Secrets](https://portal.telnyx.com/#/integration-secrets) → **Create New Integration Secret** uses **Identifier**, **Secret Value**, then **Save**. Stored values cannot be retrieved. For this project the credential must match the Edge `HRLEAVE_MCP_BEARER` value; this is distinct from a Telnyx REST API key. [1][9]
4. Review discovered **Allowed tools**, select the required tools, and **Save**. The project specifies `get_leave_policy`, `verify_employee`, `get_leave_balance`, `preview_leave`, `apply_leave`, `cancel_leave`, and `request_hr_callback`. [1][9]
5. Open the assistant → **Integrations → MCP Servers → Add MCP server**, choose the replacement, review allowed tools, and **Save**. Creating an account-level record does not automatically attach it. [1]
6. Reopen the saved assistant. The server entry's **play** button connects and discovers tools without starting a conversation; the documented success message is **“MCP server connected successfully.”** This proves discovery, not successful tool execution. [1]

## IDs, workflow, and API fallback

Creation uses `POST /v2/ai/mcp_servers`, with required `name`, `type`, and `url`, optional `api_key_ref` and `allowed_tools`, and a returned server `id`. Attach **that returned ID**; do not assume the old ID survives recreation. The create API schema does not enumerate transport string values or expose the portal's timeout field. [7]

Assistant updates use **`POST /v2/ai/assistants/{assistant_id}`**. The attachment shape is `"mcp_servers": [{"id": "<new-id>", "allowed_tools": ["get_leave_policy"]}]`. Omitted per-assistant `allowed_tools` uses the server's configured allowlist. This example intentionally shows only one tool. Preserve all other attachments when constructing the intended list. An empty array is schema-valid for removing all attachments; the field description does not separately document merge/omission semantics, so verify saved readback instead of assuming an omitted field detaches anything. **Every update saves a version**, and `promote_to_main` defaults to `true`. [8]

The workflow lives on the assistant as `conversation_flow`. Omitting it from an API update preserves it; sending `null` clears it. After reattachment, inspect each prompt node's **Tools** tab and restore its intended scope. The general workflow guide documents inherited tool toggles but does not explicitly prove individual MCP-tool scoping or automatic preservation across server recreation; the project tracks that as C-4. [9][10]

## Sources and remaining boundaries

All official pages below were fetched successfully on the research date. Portal screenshots establish documented controls, not behavior verified against this account. Static **API Key** header/scheme behavior, tool timeout enforcement, account-level deletion UI, and automatic workflow remapping were not tested. No calls, discovery requests to the deployed service, mutations, deployments, or version deletions were executed.

- [1] [Add MCP servers to an AI assistant](https://developers.telnyx.com/docs/development/mcp/assistant-mcp-servers.md), including screenshots `07-server-saved.png` and `08-attach-server.png`.
- [2] [Delete MCP Server](https://developers.telnyx.com/api-reference/mcp-servers/delete-mcp-server.md).
- [3] [Voice Assistant Quickstart — MCP Servers](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant.md#model-context-protocol-mcp-servers).
- [4] [Get all versions of an assistant](https://developers.telnyx.com/api-reference/assistants/get-all-versions-of-an-assistant.md).
- [5] [Delete a specific assistant version](https://developers.telnyx.com/api-reference/assistants/delete-a-specific-assistant-version.md).
- [6] [Version Testing and Traffic Distribution](https://developers.telnyx.com/docs/inference/ai-assistants/version-testing-traffic-distribution.md).
- [7] [Create MCP Server](https://developers.telnyx.com/api-reference/mcp-servers/create-mcp-server.md).
- [8] [Update an assistant](https://developers.telnyx.com/api-reference/assistants/update-an-assistant.md).
- [9] Project requirements: [MCP_SERVER_SPEC.md](MCP_SERVER_SPEC.md) §§2–4; [TDD.md](TDD.md) §§3, 6–7, 13.
- [10] [Conversation Workflows](https://developers.telnyx.com/docs/inference/ai-assistants/workflows.md), “Tool availability” and “Configure workflows with the API.”

Wiki consulted: `Telynyx/index.md`; `wiki/telnyx-docs-hub.md`; `wiki/telnyx-build-reading-list.md`; `wiki/telnyx-gotchas-all.md`; `development-mcp-assistant-mcp-servers`; `assistants-models-tools-and-integrations`; `assistants-workflow-nodes`; `assistants-workflow-api-schema`; `assistants-version-testing-traffic-distribution`; and generated endpoint pages for MCP create/delete and assistant update/version list/version delete. The wiki was not edited.
