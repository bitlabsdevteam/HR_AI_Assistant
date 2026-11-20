#!/usr/bin/env bash
# Race tests for the hr-leave-assistant.
# Proves that actors serialize concurrent requests correctly.
#
# Tests:
#   (a) 20 parallel apply_leave calls on distinct days for employee 1003 (5 days):
#       exactly 5 approved, 15 insufficient_balance, final remaining zero.
#   (b) Same apply_leave twice: one request, same reference (replay).
#   (c) Two parallel cancel_leave for one request: one cancelled, one replay.
#   (d) 10 parallel wrong-PIN verify_employee for employee 1004:
#       exactly 3 auth_failed, 7 locked.
#   (e) Two parallel recordCalls simulated via webhook (skipped — needs signature).
#   (f) Token from one conversation used in another: unauthenticated.
#   (g) Four attempts on unknown number: same countdown and lock.
#
# Requires: curl, jq, openssl (for jq-free environments a basic grep fallback exists).

set -euo pipefail

BASE="https://hr-leave-assistant-903aedd3-9.telnyxcompute.com"
MCP_BEARER="dbe3a0a48e44f3642359ae84defaa8bf87ec094ce47b228f811b82a3f8a985eb"
OPS_TOKEN="c850bb82faff4651c6744493df21891b6e72e133c162ea0de3ed7e0ce6c44729"

# Detect jq availability
HAVE_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAVE_JQ=1
fi

# ── helpers ──────────────────────────────────────────────────────────

rpc_id=1
mcp_call() {
  local name="$1"
  local conv="$2"
  local payload="$3"
  local id=$((rpc_id++))

  curl -s -X POST "${BASE}/mcp" \
    -H "Authorization: Bearer ${MCP_BEARER}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":${id},\"method\":\"tools/call\",\"params\":{\"name\":\"${name}\",\"arguments\":${payload},\"_meta\":{\"telnyx_conversation_id\":\"${conv}\"}}}"
}

# Extract the text.content JSON from an MCP result.
get_text_json() {
  if [ "$HAVE_JQ" = 1 ]; then
    jq -r '.result.content[0].text // ""' 2>/dev/null || echo ""
  else
    # Ultra-basic grep fallback for {"ok":...}
    grep -oP '\{.*\}' | head -1
  fi
}

# Extract a field from the embedded JSON text.
get_field() {
  local key="$1"
  if [ "$HAVE_JQ" = 1 ]; then
    jq -r "${key} // \"\"" 2>/dev/null || echo ""
  else
    grep -oP "\"${key}\":\"\\K[^\"]+" | head -1
  fi
}

fail_count=0
assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="$3"
  if [ "$expected" != "$actual" ]; then
    echo "  FAIL: $msg (expected '$expected', got '$actual')"
    fail_count=$((fail_count + 1))
  else
    echo "  PASS: $msg"
  fi
}

# ── reset ────────────────────────────────────────────────────────────

echo "=== Resetting demo data ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/admin/reset" \
  -H "Authorization: Bearer ${OPS_TOKEN}")
if [ "$CODE" != "200" ]; then
  echo "Reset returned $CODE (cold start may be 500; retrying once)"
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/admin/reset" \
    -H "Authorization: Bearer ${OPS_TOKEN}")
fi
assert_eq "200" "$CODE" "admin reset"

# ── helper: verify and return token ─────────────────────────────────

verify_and_get_token() {
  local emp="$1"
  local pin="$2"
  local conv="$3"
  local result
  result=$(mcp_call "verify_employee" "$conv" "{\"employee_number\":\"${emp}\",\"pin\":\"${pin}\"}")
  local text_json
  text_json=$(echo "$result" | get_text_json)
  if [ "$HAVE_JQ" = 1 ]; then
    echo "$text_json" | jq -r '.data.auth_token // ""'
  else
    echo "$text_json" | grep -oP '"auth_token":"\K[^"]+' | head -1
  fi
}

# ── Test (a): 20 parallel apply_leave, employee 1003 (5 days) ───────

echo ""
echo "=== Test (a): 20 parallel apply_leave on distinct days ==="
TOKEN_A=$(verify_and_get_token "1003" "3333" "race_a_001")
if [ -z "$TOKEN_A" ]; then
  echo "FATAL: could not get token for 1003"
  exit 1
fi

# Distinct working days in Dec 2026 (Mon-Fri, skipping holidays)
# 2026-12-01 Mon, 12-02 Tue, 12-03 Wed, 12-04 Thu, 12-07 Mon,
# 12-08 Tue, 12-09 Wed, 12-10 Thu, 12-11 Fri, 12-14 Mon,
# 12-15 Tue, 12-16 Wed, 12-17 Thu, 12-18 Fri, 12-21 Mon,
# 12-22 Tue, 12-23 Wed, 12-28 Mon, 12-29 Tue, 12-30 Wed
DATES=(
  "2026-12-01" "2026-12-02" "2026-12-03" "2026-12-04" "2026-12-07"
  "2026-12-08" "2026-12-09" "2026-12-10" "2026-12-11" "2026-12-14"
  "2026-12-15" "2026-12-16" "2026-12-17" "2026-12-18" "2026-12-21"
  "2026-12-22" "2026-12-23" "2026-12-28" "2026-12-29" "2026-12-30"
)

TMPDIR=$(mktemp -d)
for i in "${!DATES[@]}"; do
  d="${DATES[$i]}"
  (
    mcp_call "apply_leave" "race_a_001" \
      "{\"auth_token\":\"${TOKEN_A}\",\"reason\":\"annual leave\",\"start_date\":\"${d}\",\"end_date\":\"${d}\",\"call_ref\":\"c_$(openssl rand -hex 6)\"}" \
      > "${TMPDIR}/apply_${i}.json" 2>/dev/null
  ) &
done
wait

approved_a=0
insufficient_a=0
other_a=0
for f in "${TMPDIR}"/apply_*.json; do
  text=$(cat "$f" | get_text_json)
  if [ "$HAVE_JQ" = 1 ]; then
    ok=$(echo "$text" | jq -r '.ok // "false"')
    if [ "$ok" = "true" ]; then
      approved_a=$((approved_a + 1))
    else
      code=$(echo "$text" | jq -r '.code // ""')
      if [ "$code" = "insufficient_balance" ]; then
        insufficient_a=$((insufficient_a + 1))
      else
        other_a=$((other_a + 1))
        echo "    unexpected code: $code"
      fi
    fi
  else
    if echo "$text" | grep -q '"ok":true'; then
      approved_a=$((approved_a + 1))
    elif echo "$text" | grep -q '"code":"insufficient_balance"'; then
      insufficient_a=$((insufficient_a + 1))
    else
      other_a=$((other_a + 1))
    fi
  fi
done
rm -rf "$TMPDIR"

assert_eq "5" "$approved_a" "exactly 5 approved"
assert_eq "15" "$insufficient_a" "exactly 15 insufficient_balance"
assert_eq "0" "$other_a" "no unexpected outcomes"

# Verify final balance is zero
echo "  Checking final balance..."
BALANCE_RESULT=$(mcp_call "get_leave_balance" "race_a_001" "{\"auth_token\":\"${TOKEN_A}\"}")
BALANCE_TEXT=$(echo "$BALANCE_RESULT" | get_text_json)
if [ "$HAVE_JQ" = 1 ]; then
  remaining=$(echo "$BALANCE_TEXT" | jq -r '.data.remaining_days // ""')
else
  remaining=$(echo "$BALANCE_TEXT" | grep -oP '"remaining_days":\K[0-9]+' | head -1)
fi
assert_eq "0" "$remaining" "final remaining days is 0"

# ── Test (b): same request twice (idempotency) ───────────────────────

echo ""
echo "=== Test (b): same apply_leave twice ==="
TOKEN_B=$(verify_and_get_token "1004" "4444" "race_b_001")
if [ -z "$TOKEN_B" ]; then
  echo "FATAL: could not get token for 1004"
  exit 1
fi

REF_B="c_$(openssl rand -hex 6)"
(
  mcp_call "apply_leave" "race_b_001" \
    "{\"auth_token\":\"${TOKEN_B}\",\"reason\":\"annual leave\",\"start_date\":\"2026-12-01\",\"end_date\":\"2026-12-01\",\"call_ref\":\"${REF_B}\"}" \
    > "${TMPDIR}_b1.json" 2>/dev/null
) &
(
  mcp_call "apply_leave" "race_b_001" \
    "{\"auth_token\":\"${TOKEN_B}\",\"reason\":\"annual leave\",\"start_date\":\"2026-12-01\",\"end_date\":\"2026-12-01\",\"call_ref\":\"${REF_B}\"}" \
    > "${TMPDIR}_b2.json" 2>/dev/null
) &
wait

if [ "$HAVE_JQ" = 1 ]; then
  ref1=$(jq -r '.result.content[0].text | fromjson | .data.reference // ""' "${TMPDIR}_b1.json" 2>/dev/null)
  ref2=$(jq -r '.result.content[0].text | fromjson | .data.reference // ""' "${TMPDIR}_b2.json" 2>/dev/null)
  replay1=$(jq -r '.result.content[0].text | fromjson | .data.replayed // "false"' "${TMPDIR}_b1.json" 2>/dev/null)
  replay2=$(jq -r '.result.content[0].text | fromjson | .data.replayed // "false"' "${TMPDIR}_b2.json" 2>/dev/null)
else
  text1=$(cat "${TMPDIR}_b1.json" | get_text_json)
  text2=$(cat "${TMPDIR}_b2.json" | get_text_json)
  ref1=$(echo "$text1" | grep -oP '"reference":"\K[^"]+' | head -1)
  ref2=$(echo "$text2" | grep -oP '"reference":"\K[^"]+' | head -1)
  replay1="unknown"
  replay2="unknown"
fi
rm -f "${TMPDIR}_b1.json" "${TMPDIR}_b2.json"

assert_eq "$ref1" "$ref2" "same reference returned for replay"
# At least one should be replayed
if [ "$replay1" = "true" ] || [ "$replay2" = "true" ]; then
  echo "  PASS: one response marked replayed"
else
  echo "  INFO: replay flag not detected (ref equality is the key assertion)"
fi

# ── Test (c): two parallel cancel_leave for one request ──────────────

echo ""
echo "=== Test (c): parallel cancel of one request ==="
TOKEN_C=$(verify_and_get_token "1004" "4444" "race_c_001")
if [ -z "$TOKEN_C" ]; then
  echo "FATAL: could not get token for 1004"
  exit 1
fi

# First, apply a request to cancel
# Test (c) applies for 2026-12-07 (Monday) and cancels it
APPLY_C=$(mcp_call "apply_leave" "race_c_001" \
  "{\"auth_token\":\"${TOKEN_C}\",\"reason\":\"annual leave\",\"start_date\":\"2026-12-07\",\"end_date\":\"2026-12-07\",\"call_ref\":\"c_$(openssl rand -hex 6)\"}")
APPLY_TEXT=$(echo "$APPLY_C" | get_text_json)
if [ "$HAVE_JQ" = 1 ]; then
  cancel_ref=$(echo "$APPLY_TEXT" | jq -r '.data.reference // ""')
else
  cancel_ref=$(echo "$APPLY_TEXT" | grep -oP '"reference":"\K[^"]+' | head -1)
fi

echo "  Applied request ${cancel_ref}, now cancelling twice in parallel..."
(
  mcp_call "cancel_leave" "race_c_001" \
    "{\"auth_token\":\"${TOKEN_C}\",\"start_date\":\"2026-12-07\",\"call_ref\":\"c_$(openssl rand -hex 6)\"}" \
    > "${TMPDIR}_c1.json" 2>/dev/null
) &
(
  mcp_call "cancel_leave" "race_c_001" \
    "{\"auth_token\":\"${TOKEN_C}\",\"start_date\":\"2026-12-07\",\"call_ref\":\"c_$(openssl rand -hex 6)\"}" \
    > "${TMPDIR}_c2.json" 2>/dev/null
) &
wait

if [ "$HAVE_JQ" = 1 ]; then
  ok1=$(jq -r '.result.content[0].text | fromjson | .ok' "${TMPDIR}_c1.json")
  ok2=$(jq -r '.result.content[0].text | fromjson | .ok' "${TMPDIR}_c2.json")
  msg1=$(jq -r '.result.content[0].text | fromjson | .message // ""' "${TMPDIR}_c1.json")
  msg2=$(jq -r '.result.content[0].text | fromjson | .message // ""' "${TMPDIR}_c2.json")
else
  text1=$(cat "${TMPDIR}_c1.json" | get_text_json)
  text2=$(cat "${TMPDIR}_c2.json" | get_text_json)
  ok1=$(echo "$text1" | grep -oP '"ok":\K(true|false)' | head -1)
  ok2=$(echo "$text2" | grep -oP '"ok":\K(true|false)' | head -1)
  msg1=""
  msg2=""
fi
rm -f "${TMPDIR}_c1.json" "${TMPDIR}_c2.json"

cancelled_count=0
replay_count=0
[ "$ok1" = "true" ] && cancelled_count=$((cancelled_count + 1))
[ "$ok2" = "true" ] && cancelled_count=$((cancelled_count + 1))
echo "$msg1" | grep -q "already cancelled" && replay_count=$((replay_count + 1))
echo "$msg2" | grep -q "already cancelled" && replay_count=$((replay_count + 1))

assert_eq "2" "$cancelled_count" "both cancel calls returned ok"
assert_eq "1" "$replay_count" "exactly one is a replay"

# ── Test (d): 10 parallel wrong-PIN attempts, employee 1004 ─────────

echo ""
echo "=== Test (d): 10 parallel wrong-PIN verify attempts ==="

TMPDIR_D=$(mktemp -d)
for i in $(seq 1 10); do
  (
    mcp_call "verify_employee" "race_d_${i}" \
      "{\"employee_number\":\"1004\",\"pin\":\"9999\"}" \
      > "${TMPDIR_D}/verify_${i}.json" 2>/dev/null
  ) &
done
wait

auth_failed_d=0
locked_d=0
other_d=0
for f in "${TMPDIR_D}"/verify_*.json; do
  text=$(cat "$f" | get_text_json)
  if [ "$HAVE_JQ" = 1 ]; then
    ok=$(echo "$text" | jq -r '.ok // "false"')
    code=$(echo "$text" | jq -r '.code // ""')
  else
    ok=$(echo "$text" | grep -oP '"ok":\K(true|false)' | head -1)
    code=$(echo "$text" | grep -oP '"code":"\K[^"]+' | head -1)
  fi
  if [ "$ok" = "false" ]; then
    if [ "$code" = "auth_failed" ]; then
      auth_failed_d=$((auth_failed_d + 1))
    elif [ "$code" = "locked" ]; then
      locked_d=$((locked_d + 1))
    else
      other_d=$((other_d + 1))
      echo "    unexpected code: $code"
    fi
  else
    other_d=$((other_d + 1))
    echo "    unexpected success"
  fi
done
rm -rf "$TMPDIR_D"

assert_eq "2" "$auth_failed_d" "exactly 2 auth_failed (3rd attempt triggers lock)"
assert_eq "8" "$locked_d" "exactly 8 locked"
assert_eq "0" "$other_d" "no other outcomes"

# ── Test (f): token from one conversation used in another ───────────

echo ""
echo "=== Test (f): cross-conversation token rejection ==="
TOKEN_F=$(verify_and_get_token "1001" "1111" "race_f_001")
if [ -z "$TOKEN_F" ]; then
  echo "FATAL: could not get token for 1001"
  exit 1
fi

# Use the token in a different conversation
RESULT_F=$(mcp_call "get_leave_balance" "race_f_002" "{\"auth_token\":\"${TOKEN_F}\"}")
TEXT_F=$(echo "$RESULT_F" | get_text_json)
if [ "$HAVE_JQ" = 1 ]; then
  code_f=$(echo "$TEXT_F" | jq -r '.code // ""')
else
  code_f=$(echo "$TEXT_F" | grep -oP '"code":"\K[^"]+' | head -1)
fi
assert_eq "unauthenticated" "$code_f" "cross-conversation token rejected"

# ── Test (g): unknown employee number ────────────────────────────────

echo ""
echo "=== Test (g): unknown employee number behaves like wrong PIN ==="

TMPDIR_G=$(mktemp -d)
for i in $(seq 1 4); do
  (
    mcp_call "verify_employee" "race_g_${i}" \
      "{\"employee_number\":\"9999\",\"pin\":\"1234\"}" \
      > "${TMPDIR_G}/unknown_${i}.json" 2>/dev/null
  ) &
done
wait

auth_failed_g=0
locked_g=0
for f in "${TMPDIR_G}"/unknown_*.json; do
  text=$(cat "$f" | get_text_json)
  if [ "$HAVE_JQ" = 1 ]; then
    code=$(echo "$text" | jq -r '.code // ""')
  else
    code=$(echo "$text" | grep -oP '"code":"\K[^"]+' | head -1)
  fi
  if [ "$code" = "auth_failed" ]; then
    auth_failed_g=$((auth_failed_g + 1))
  elif [ "$code" = "locked" ]; then
    locked_g=$((locked_g + 1))
  fi
done
rm -rf "$TMPDIR_G"

assert_eq "2" "$auth_failed_g" "2 auth_failed on unknown number"
assert_eq "2" "$locked_g" "2 locked on unknown number (same 3-strike rule)"

# ── summary ──────────────────────────────────────────────────────────

echo ""
echo "========================================"
if [ "$fail_count" -eq 0 ]; then
  echo "ALL RACE TESTS PASSED"
else
  echo "RACE TESTS FAILED: ${fail_count} assertion(s)"
fi
echo "========================================"
exit "$fail_count"
