# Tech Support Commands — HR Leave Assistant

Reference: `docs/TDD.md`, `telnyx.toml`, Telnyx wiki `edge-compute-cli-reference`, `edge-compute-kv-cli`.

---

## 1. KV (Key-Value Store)

Namespace ID: `1b0b0a50-c921-498d-9916-ec3f085da147`

### 1.1 Read keys

```bash
# Feature flag: are leave changes paused?
telnyx-edge storage kv key get 1b0b0a50-c921-498d-9916-ec3f085da147 flags/leave_changes_enabled

# Company profile (JSON)
telnyx-edge storage kv key get 1b0b0a50-c921-498d-9916-ec3f085da147 profile/current
```

### 1.2 Write keys

```bash
# Toggle leave changes without redeploying
telnyx-edge storage kv key put 1b0b0a50-c921-498d-9916-ec3f085da147 flags/leave_changes_enabled "false"

# Write profile JSON (inline)
telnyx-edge storage kv key put 1b0b0a50-c921-498d-9916-ec3f085da147 profile/current '{"companyName":"Cedar Group",...}'

# Write from file
telnyx-edge storage kv key put 1b0b0a50-c921-498d-9916-ec3f085da147 profile/current --path ./profile.json

# Write with TTL (seconds)
telnyx-edge storage kv key put 1b0b0a50-c921-498d-9916-ec3f085da147 session/abc "hello" --ttl 30s
```

### 1.3 List / delete keys

```bash
# List all keys
telnyx-edge storage kv key list 1b0b0a50-c921-498d-9916-ec3f085da147

# List with prefix
telnyx-edge storage kv key list 1b0b0a50-c921-498d-9916-ec3f085da147 --prefix flags/

# Delete one key
telnyx-edge storage kv key delete 1b0b0a50-c921-498d-9916-ec3f085da147 flags/leave_changes_enabled
```

### 1.4 Namespace lifecycle (read-only)

```bash
# List namespaces
telnyx-edge storage kv list

# Get namespace metadata
telnyx-edge storage kv get 1b0b0a50-c921-498d-9916-ec3f085da147
```

> **KV gotchas:** Keys use `/` as separator; **colons are not allowed**. Values are raw bytes — JSON must be stored as a string and parsed on read. Max value: 1 MiB. Max key length: 256 chars.

---

### Query caller session records

```bash
# List all session keys
telnyx-edge storage kv key list 1b0b0a50-c921-498d-9916-ec3f085da147 --prefix session/

# Read one caller's session
telnyx-edge storage kv key get 1b0b0a50-c921-498d-9916-ec3f085da147 session/caller/<hash>
```

---

## 2. SQL Database (Edge Compute)

Database: `teradb`, ID `34d8ea59-4311-4c50-b70f-77e50d9a4ea6`

```bash
# Create a SQL database
telnyx-edge storage sqldb create --name my-db

# Run a remote query on teradb
telnyx-edge storage sqldb execute teradb --remote --command "SELECT COUNT(*) AS n FROM Employee"

# Read one employee row
telnyx-edge storage sqldb execute teradb --remote --command "SELECT * FROM Employee WHERE employee_number = '1001'"

# Export schema + data
telnyx-edge storage sqldb export teradb --remote --output ./database.sql

# List tables / inspect
telnyx-edge storage sqldb list
```

---

## 3. Edge Function: Deploy & Status

```bash
# Deploy the function (requires explicit authorisation — billable)
telnyx-edge ship

# Check ship status
telnyx-edge ship status hr-leave-assistant

# Show build logs
telnyx-edge ship status hr-leave-assistant --logs

# List all functions
telnyx-edge list

# Inspect this function
telnyx-edge inspect hr-leave-assistant

# Show deployments & revisions
telnyx-edge deployments hr-leave-assistant

# Rollback if needed
telnyx-edge rollback hr-leave-assistant <revision-id>
```

> **Note:** `telnyx-edge ship` must only be run when David has requested it for the current session. Secrets are injected at deploy time, so a changed secret always needs a fresh `ship`.

---

## 4. Stateful Actors

Actor types: `EmployeeLeave`, `HrDesk`, `CallerProfile`

```bash
# List registered actor types
telnyx-edge actors list

# Inspect a type (attached functions, live instance count)
telnyx-edge actors inspect EmployeeLeave

# List persisted instances (type/id pairs)
telnyx-edge actors instances EmployeeLeave

# Actor invocation logs
telnyx-edge actors logs EmployeeLeave
telnyx-edge actors logs EmployeeLeave --type invocations
telnyx-edge actors logs EmployeeLeave --tail

# Actor metrics (default: last 24h)
telnyx-edge actors metrics EmployeeLeave
telnyx-edge actors metrics EmployeeLeave --since 1h --json

# Delete an actor type (destructive)
telnyx-edge actors delete EmployeeLeave
```

---

## 5. Secrets

```bash
# List Edge secrets
telnyx-edge secrets list

# Add a new secret (billable-class action; only on David's request)
telnyx-edge secrets add HRLEAVE_MCP_BEARER

# Update an existing secret
telnyx-edge secrets update HRLEAVE_MCP_BEARER

# Delete a secret
telnyx-edge secrets delete HRLEAVE_MCP_BEARER
```

> Secrets are injected at **deploy time**. Changing a secret value requires `telnyx-edge ship` to take effect.

---

## 6. Logs & Metrics

> **Retention:** Live logs are retained for **72 hours** (as of 2026-11-15).  
> **Format:** The application emits one structured JSON line per request (see `src/lib/log.ts`). Use `--json` with `jq` for filtering.

### 6.1 Function logs

```bash
# Last hour, up to 50 lines (runtime logs)
telnyx-edge logs hr-leave-assistant

# Runtime logs with time window
telnyx-edge logs hr-leave-assistant --since 10m

# Invocation logs (one per HTTP request)
telnyx-edge logs hr-leave-assistant --type invocations

# Last N lines
telnyx-edge logs hr-leave-assistant --last 200

# JSON for structured parsing
telnyx-edge logs hr-leave-assistant --json
telnyx-edge logs hr-leave-assistant --type invocations --json

# Live tail (WebSocket)
telnyx-edge logs hr-leave-assistant --tail
telnyx-edge logs hr-leave-assistant --tail --json
```

### 6.2 Longer periods

```bash
# Last 30 minutes
telnyx-edge logs hr-leave-assistant --since 30m

# Last 2 hours
telnyx-edge logs hr-leave-assistant --since 2h

# Last 6 hours
telnyx-edge logs hr-leave-assistant --since 6h

# Last 500 lines (ignores time)
telnyx-edge logs hr-leave-assistant --last 500

# Invocation logs for last 2 hours
telnyx-edge logs hr-leave-assistant --type invocations --since 2h

# JSON across a long window
telnyx-edge logs hr-leave-assistant --since 6h --json
```

### 6.3 Error logs

```bash
# Only error outcomes
telnyx-edge logs hr-leave-assistant --json | jq 'select(.outcome == "error")'

# Error outcomes in last 6 hours
telnyx-edge logs hr-leave-assistant --since 6h --json | jq 'select(.outcome == "error")'

# Pretty-print key fields for errors
telnyx-edge logs hr-leave-assistant --since 6h --json | jq 'select(.outcome == "error") | {ts, event, outcome, status, call_ref, duration_ms, detail, failed}'

# Filter by severity level
telnyx-edge logs hr-leave-assistant --json | jq 'select(.level == "error")'

# Authentication failures
telnyx-edge logs hr-leave-assistant --json | jq 'select(.outcome | test("auth_failed|locked|unauthenticated|unauthorized"))'

# Business rule failures
telnyx-edge logs hr-leave-assistant --json | jq 'select(.outcome | test("insufficient_balance|overlap|out_of_policy"))'

# Actor unavailable or dependency failures
telnyx-edge logs hr-leave-assistant --json | jq 'select(.detail == "actor_unavailable")'

# KV or Roster errors
telnyx-edge logs hr-leave-assistant --json | jq 'select(.kv == "error" or .roster == "error")'

# Failed ops-check dependencies
telnyx-edge logs hr-leave-assistant --json | jq 'select(.failed != null)'
```

### 6.4 Specific tool logs

```bash
# verify_employee
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "verify_employee")'

# get_leave_balance
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "get_leave_balance")'

# apply_leave
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "apply_leave")'

# cancel_leave
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "cancel_leave")'

# get_leave_policy
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "get_leave_policy")'

# request_callback
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "request_callback")'

# list_upcoming_leave
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "list_upcoming_leave")'
```

### 6.5 Specific tool + time window

```bash
# verify_employee in last 30 minutes
telnyx-edge logs hr-leave-assistant --since 30m --json | jq 'select(.tool == "verify_employee")'

# apply_leave in last 2 hours
telnyx-edge logs hr-leave-assistant --since 2h --json | jq 'select(.tool == "apply_leave")'

# Specific tool, last 200 lines only
telnyx-edge logs hr-leave-assistant --last 200 --json | jq 'select(.tool == "cancel_leave")'
```

### 6.6 Specific tool + outcome

```bash
# verify_employee that failed auth
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "verify_employee" and .outcome == "auth_failed")'

# apply_leave approved
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "apply_leave" and .outcome == "approved")'

# cancel_leave cancelled
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "cancel_leave" and .outcome == "cancelled")'

# get_leave_balance ok
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "get_leave_balance" and .outcome == "ok")'

# Any tool with error
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "apply_leave" and .outcome == "error")'

# Any tool unauthenticated
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "get_leave_balance" and .outcome == "unauthenticated")'
```

### 6.7 Compact views

```bash
# verify_employee: key fields only
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "verify_employee") | {ts, outcome, status, call_ref, emp, duration_ms, actor_ms}'

# apply_leave: show outcome and actor_event
telnyx-edge logs hr-leave-assistant --json | jq 'select(.tool == "apply_leave") | {ts, outcome, status, call_ref, actor_event, duration_ms}'
```

### 6.8 Live tail for one tool

```bash
# Watch verify_employee in real-time
telnyx-edge logs hr-leave-assistant --tail --json | jq 'select(.tool == "verify_employee")'

# Watch balance-related tools
telnyx-edge logs hr-leave-assistant --tail --json | jq 'select(.tool == "get_leave_balance" or .tool == "get_leave_policy")'
```

### 6.9 Summaries

```bash
# Count calls per tool in last hour
telnyx-edge logs hr-leave-assistant --since 1h --json | jq -r '.tool // "webhook"' | sort | uniq -c | sort -rn

# Count errors by outcome in last 6 hours
telnyx-edge logs hr-leave-assistant --since 6h --json | jq -r '.outcome' | sort | uniq -c | sort -rn

# Group by HTTP status
telnyx-edge logs hr-leave-assistant --since 6h --json | jq -r '"\(.status) \(.outcome)"' | sort | uniq -c | sort -rn
```

### 6.10 Actor logs

```bash
# EmployeeLeave actor errors
telnyx-edge actors logs EmployeeLeave --json | jq 'select(.outcome == "error")'

# HrDesk actor errors
telnyx-edge actors logs HrDesk --json | jq 'select(.outcome == "error")'

# Live tail for actors
telnyx-edge actors logs EmployeeLeave --tail
```

### 6.11 Metrics

```bash
# Function metrics (24h window)
telnyx-edge metrics hr-leave-assistant

# Shorter window, JSON output
telnyx-edge metrics hr-leave-assistant --since 1h --json
```

### 6.12 Trace a specific call

```bash
# Find one call by call_ref (shell helper in repo)
scripts/trace.sh c_4f9a1c22b07e
```

---

## 7. Health & Ops (curl)

Base URL: `https://hr-leave-assistant-903aedd3-9.telnyxcompute.com`

```bash
BASE="https://hr-leave-assistant-903aedd3-9.telnyxcompute.com"
OPS_TOKEN="<your-ops-token>"

# Health checks (public, no auth)
curl -s "${BASE}/health/liveness"
curl -s "${BASE}/health/readiness"

# Ops check — pings KV + all three actors
curl -s "${BASE}/ops/check" \
  -H "Authorization: Bearer ${OPS_TOKEN}"
```

### Ops check response
```json
{
  "kv": { "status": "ok", "ms": 12 },
  "hrDesk": { "status": "ok", "ms": 34 },
  "callerProfile": { "status": "ok", "ms": 28 },
  "employeeLeave": { "status": "ok", "ms": 41 }
}
```

> Returns `503` if any dependency fails.

---

## 8. Admin Routes (curl)

Requires bearer `OPS_TOKEN`.

```bash
# Seed SQL roster from bundled demo data
curl -s -X POST "${BASE}/admin/seed-employees" \
  -H "Authorization: Bearer ${OPS_TOKEN}"

# Reset all demo data (employee balances, callbacks, counters)
curl -s -X POST "${BASE}/admin/reset" \
  -H "Authorization: Bearer ${OPS_TOKEN}"

# List leave requests for all employees
curl -s "${BASE}/admin/requests" \
  -H "Authorization: Bearer ${OPS_TOKEN}"

# List requests for one employee
curl -s "${BASE}/admin/requests?employee=1001" \
  -H "Authorization: Bearer ${OPS_TOKEN}"

# List callback requests
curl -s "${BASE}/admin/callbacks" \
  -H "Authorization: Bearer ${OPS_TOKEN}"

# Get outcome counters (verifications, approvals, lockouts, etc.)
curl -s "${BASE}/admin/stats" \
  -H "Authorization: Bearer ${OPS_TOKEN}"
```

---

## 9. MCP Server (curl)

Requires bearer `MCP_BEARER`.

```bash
MCP_BEARER="<your-mcp-bearer>"

# List tools
curl -s -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${MCP_BEARER}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Get leave policy (no auth_token needed)
curl -s -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${MCP_BEARER}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_leave_policy",
      "arguments": {"topic": "entitlement"},
      "_meta": {"telnyx_conversation_id": "conv_test_001"}
    }
  }'

# Verify employee (returns auth_token)
curl -s -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${MCP_BEARER}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 3,
    "method": "tools/call",
    "params": {
      "name": "verify_employee",
      "arguments": {"employee_number": "1001", "pin": "1234"},
      "_meta": {"telnyx_conversation_id": "conv_test_001"}
    }
  }'
```

---

## 10. Smoke Test (local script)

```bash
# Full smoke test against deployed function
./scripts/smoke.sh
```

Validates: health check, MCP 401 without bearer, ops 401 without bearer, MCP tools/list, `get_leave_policy`, admin reset, admin requests.

---

## 11. Seeding KV (local script)

```bash
# Seed the flag and company profile after a fresh namespace create
./scripts/seed-kv.sh
```

---

## 12. Employee Data: Where It Lives & How to Query It

### 12.1 Three storage layers

| Layer | Where | What it holds |
|-------|-------|---------------|
| **SQL roster** | `teradb.Employee` | Active employees: number, name, entitlement, opening used days, PIN hash, secret question/answer hash, active flag. Operator-editable without deploy. |
| **`EmployeeLeave` actor** | `this.ctx.storage` (durable, one instance per employee) | PIN hash (synced from SQL), balance, leave requests, attempt counters, lockout state. The runtime source of truth for balances and lockouts. |
| **Static seed data** | `src/config/default-employees.ts` (bundled) | 4 demo employees with plaintext PINs. Used only by `/admin/seed-employees` to populate SQL; never read at runtime. |

The SQL roster is the **credential source of truth** (who exists, their hashes, active status). The actor refreshes its profile from SQL at sign-in. `/admin/reset` resets actors from the SQL roster, not from the static file.

### 12.2 Actor storage keys per employee

| Key | Content |
|-----|---------|
| `profile` | `{ firstName, entitlementDays, openingUsedDays, pinHash, secretQuestion, secretAnswerHash, failedAttempts, lockedUntil }` |
| `requests` | Array of `{ reference, start, end, days, status, createdAt, cancelledAt, callRef }` |
| `key/<requestKey>` | Idempotency lookup for existing requests |
| `counters` | `{ verified, authFailures, lockouts, approved, replays, insufficient, overlaps, cancelled, cancelReplays }` |

### 12.3 Query via admin endpoint (recommended)

```bash
BASE="https://hr-leave-assistant-903aedd3-9.telnyxcompute.com"
OPS_TOKEN="<your-ops-token>"

# One employee: balance + requests
curl -s "${BASE}/admin/requests?employee=1001" \
  -H "Authorization: Bearer ${OPS_TOKEN}" | jq .

# All employees
curl -s "${BASE}/admin/requests" \
  -H "Authorization: Bearer ${OPS_TOKEN}" | jq .
```

### 12.4 Query outcome counters (stats)

```bash
curl -s "${BASE}/admin/stats" \
  -H "Authorization: Bearer ${OPS_TOKEN}" | jq .
```

Returns aggregated counters: verified, auth failures, lockouts, approved, replays, insufficient balance, overlaps, cancelled, callback replays.

### 12.5 Query via actor logs

```bash
# Invocation logs for all EmployeeLeave actors
telnyx-edge actors logs EmployeeLeave --type invocations

# Tail live
telnyx-edge actors logs EmployeeLeave --tail

# List all persisted instances (one per employee)
telnyx-edge actors instances EmployeeLeave
```

### 12.6 Seed SQL roster from bundled data

```bash
curl -s -X POST "${BASE}/admin/seed-employees" \
  -H "Authorization: Bearer ${OPS_TOKEN}"
```

Idempotent: upserts the 4 demo employees into `teradb.Employee`, computing hashes from the secret `HASH_KEY`.

### 12.7 Reset all actor demo data

```bash
curl -s -X POST "${BASE}/admin/reset" \
  -H "Authorization: Bearer ${OPS_TOKEN}"
```

Resets every active employee's actor from the SQL roster, clears all leave requests, resets balances to opening values, and zeroes lockouts/counters.

### 12.8 Demo employee PINs

| Number | Name | PIN |
|--------|------|-----|
| 1001 | Alex Rivera | 1111 |
| 1002 | Priya Nair | 2222 |
| 1003 | Sam Okafor | 3333 |
| 1004 | Jordan Lee | 4444 |

> **Security:** PINs are stored as HMAC-SHA-256 hashes in SQL and inside the actor, never as plaintext. The static file is synthetic demo data only.

---

## 13. Quick Reference IDs

| Resource | ID / Name |
|----------|-----------|
| KV Namespace | `1b0b0a50-c921-498d-9916-ec3f085da147` |
| SQL Database | `teradb` (`34d8ea59-4311-4c50-b70f-77e50d9a4ea6`) |
| Function | `hr-leave-assistant` |
| Function ID | `903aedd3-9771-4f31-ad51-2d4160cd7127` |
| Actor types | `EmployeeLeave`, `HrDesk`, `CallerProfile` |
| KV key: leave flag | `flags/leave_changes_enabled` |
| KV key: profile | `profile/current` |
| KV key prefix | `session/caller/` |
