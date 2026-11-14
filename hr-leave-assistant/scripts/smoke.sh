#!/usr/bin/env bash
# Smoke test against deployed hr-leave-assistant

set -euo pipefail

BASE="https://hr-leave-assistant-903aedd3-9.telnyxcompute.com"

echo "=== Health check ==="
curl -s "${BASE}/health/liveness" && echo " ✅"

echo ""
echo "=== MCP: 401 without bearer ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/mcp" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
if [ "$CODE" = "401" ]; then
  echo "MCP 401: ✅"
else
  echo "MCP $CODE: ❌ expected 401"
fi

echo ""
echo "=== Admin/ops: 401 without bearer ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/ops/check")
if [ "$CODE" = "401" ]; then
  echo "Ops 401: ✅"
else
  echo "Ops $CODE: ❌ expected 401"
fi

echo ""
echo "=== MCP: tools/list with bearer ==="
MCP_BEARER="dbe3a0a48e44f3642359ae84defaa8bf87ec094ce47b228f811b82a3f8a985eb"
RESULT=$(curl -s -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${MCP_BEARER}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 800)
echo "$RESULT"

echo ""
echo "=== MCP: get_leave_policy with bearer ==="
RESULT=$(curl -s -X POST "${BASE}/mcp" \
  -H "Authorization: Bearer ${MCP_BEARER}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_leave_policy","arguments":{"topic":"entitlement"},"_meta":{"telnyx_conversation_id":"conv_test_001"}}}')
echo "$RESULT" | head -c 500

SOURCE=$(echo "$RESULT" | grep -o '"source":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ "$SOURCE" = "kv" ] || [ "$SOURCE" = "fallback" ]; then
  echo ""
  echo "get_leave_policy source=$SOURCE: ✅"
else
  echo ""
  echo "get_leave_policy source=${SOURCE:-unknown}: ❌ expected kv or fallback"
fi

echo ""
echo "=== Admin reset with bearer ==="
OPS_TOKEN="c850bb82faff4651c6744493df21891b6e72e133c162ea0de3ed7e0ce6c44729"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/admin/reset" \
  -H "Authorization: Bearer ${OPS_TOKEN}")
if [ "$CODE" = "200" ]; then
  echo "Admin reset 200: ✅"
else
  echo "Admin reset $CODE: ❌ (expected 200 if actors are warm, may be 500 on cold start)"
fi

echo ""
echo "=== Admin requests with bearer ==="
curl -s "${BASE}/admin/requests" -H "Authorization: Bearer ${OPS_TOKEN}" | head -c 800

echo ""
echo "Done."
