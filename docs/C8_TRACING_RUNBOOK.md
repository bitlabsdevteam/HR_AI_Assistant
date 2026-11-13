# C-8 runbook: keep PINs and tokens out of Langfuse traces

Tracks issue #35. Source of the requirement: TDD §9 item 9, §10.5, and check C-8 in §13. A PIN present in a trace is a blocking security finding.

## Why this exists

A Langfuse trace of an assistant call showed the PIN in the traced `verify_employee` input and the session token in the traced output, and an assistant privacy readback showed `pii_redaction: disabled`. This is assistant and platform configuration. The function code cannot redact what the platform exports.

## Rule until the check passes

Keep `observability_settings` disabled, or enabled only for calls that use a throwaway synthetic PIN. Do not enable tracing for real employee calls.

## Steps

Each step that changes the remote assistant or places a call is an explicit, separate action by the account owner.

1. **Read back the current state.** `GET /v2/ai/assistants/{id}`. Record `observability_settings.status`, the secret refs and host (never secret values), and the privacy settings including `pii_redaction`.
2. **Set the intended privacy configuration.** `pii_redaction` per TDD §6.4. Read the assistant back again and confirm the value stuck.
3. **Place one synthetic call.** Use a throwaway employee number and PIN that exist only for this test. Sign in and ask for the balance.
4. **Inspect the trace.** Trace ID is the first 32 hex characters of the SHA-256 of the UTF-8 `conversation_id`. Search input messages, outputs and tool arguments for the PIN digits, both as digits and as spoken words, and for the session token.
5. **Record the result.** Add a `docs/DEVLOG.md` line with: PIN found or not found, token found or not found, whether MCP tool calls appear as `tool-call-<name>`, the settings read back, and the model ID. Remove the C-8 line from the "Still unverified" list in `CLAUDE.md` only when the check has passed.

## Outcomes

- **Synthetic PIN and token absent:** C-8 passes. Tracing may be enabled for calls under the recorded settings.
- **PIN or token present with redaction on:** redaction does not cover tool inputs or outputs. Leave tracing disabled for real calls, name the limitation in the README (TDD §9 item 9), and tell the account owner before any further call.
- **Traces absent:** check `status`, secret refs and host against the readback, then rerun.

## Constraints

- Never paste a real PIN, employee number, token, or trace body into an issue, PR or log.
- Function-side spans stay allowlisted per TDD §10.1: pseudonyms, tool name, outcome, durations, `call_ref`.
