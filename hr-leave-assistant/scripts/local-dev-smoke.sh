#!/usr/bin/env bash
# Local dev test runner — exercises routes against telnyx-edge dev (port 8787).
# telnyx-edge dev does not emulate KV or secrets, so most routes will fail
# or degrade. This script proves the routes exist and respond.

set -euo pipefail

BASE="http://127.0.0.1:8787"

echo "=== Health checks ==="
curl -s -o /dev/null -w "%{http_code}" "${BASE}/health/liveness" | grep -q 200 && echo "Liveness: 200 OK" || echo "Liveness: FAIL"
curl -s -o /dev/null -w "%{http_code}" "${BASE}/health/readiness" | grep -q 200 && echo "Readiness: 200 OK" || echo "Readiness: FAIL"

echo ""
echo "=== Webhook (no signature => 401) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "${BASE}/webhooks/dynamic-variables" -H "Content-Type: application/json" -d '{"data":{"id":"evt_test","event_type":"assistant.initialization","payload":{}}}' | tail -1

echo ""
echo "=== MCP (no bearer => 401) ==="
curl -s -w "\nHTTP %{http_code}\n" -X POST "${BASE}/mcp" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | tail -1

echo ""
echo "=== Ops check (no bearer => 401) ==="
curl -s -o /dev/null -w "%{http_code}" "${BASE}/ops/check" | grep -q 401 && echo "Ops: 401 as expected" || echo "Ops: unexpected response"

echo ""
echo "=== Admin reset (no bearer => 401) ==="
curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/admin/reset" | grep -q 401 && echo "Admin reset: 401 as expected" || echo "Admin reset: unexpected response"

echo ""
echo "Done. KV and secrets are not emulated in local dev; deploy for full integration."
