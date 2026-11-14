# Verification-to-balance diagnosis

These files accompany the [2026-11-14 incident report](../incidents/2026-11-14-verification-balance-token-handoff.md). They are outside the application test suite and do not change its source or platform configuration.

- `2026-11-14-verification-balance-evidence.json`: minimized read-only account evidence. It retains tool outcomes, token lengths/format/equality verdicts, and identifiers needed to correlate the call. No raw tool bodies, credentials, names, employee numbers, PINs or caller speech.
- `verification-balance.diagnostic.test.ts`: real MCP handler/SDK, token implementation and employee-actor methods with deterministic local storage and bindings.
- `vitest.config.mjs`: runs only the diagnostic harness.

From `hr-leave-assistant/`:

```sh
./node_modules/.bin/vitest run --config ../docs/diagnostics/vitest.config.mjs
```

The unmodified application intentionally produces **3 passes and 1 failure**: the text result does not contain the token needed for the next tool. This red diagnostic records the outstanding defect; it is not a regression introduced by this investigation. The proposed serialized-text change was tested in an isolated `/private/tmp/hr-balance-proposed-fix-sl4mr05r` copy, where all four cases passed. See the incident for the exact change and validation limits.
