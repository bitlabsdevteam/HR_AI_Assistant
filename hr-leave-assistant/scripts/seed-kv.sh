#!/usr/bin/env bash
set -euo pipefail

NAMESPACE_ID="1b0b0a50-c921-498d-9916-ec3f085da147"

# Seed the leave-changes flag
telnyx-edge storage kv key put "$NAMESPACE_ID" flags/leave_changes_enabled "true"

# Seed the company profile
telnyx-edge storage kv key put "$NAMESPACE_ID" profile/current '{
  "companyName": "Cedar Group",
  "timezone": "America/New_York",
  "entitlementDays": 14,
  "hours": {
    "monday": { "open": "09:00", "close": "17:00" },
    "tuesday": { "open": "09:00", "close": "17:00" },
    "wednesday": { "open": "09:00", "close": "17:00" },
    "thursday": { "open": "09:00", "close": "17:00" },
    "friday": { "open": "09:00", "close": "17:00" },
    "saturday": null,
    "sunday": null
  },
  "leaveYear": { "start": "2026-07-01", "end": "2027-06-30" },
  "holidays": ["2026-11-26", "2026-12-25", "2027-01-01"],
  "minNoticeDays": 1,
  "maxRequestDays": 10,
  "policy": {
    "entitlement": "Full-time employees receive 14 days of annual leave for the leave year from July 1, 2026 through June 30, 2027.",
    "notice": "Ask for annual leave at least one calendar day before the first day of leave. A request may contain up to 10 working days.",
    "carry_over": "This phone service handles annual leave for the current leave year only. Please ask the HR team about carry-over.",
    "holidays": "Annual leave counts Monday through Friday, excluding November 26, 2026, December 25, 2026, and January 1, 2027.",
    "process": "After signing in, give the first and last day of your leave. The assistant reads the request back and asks for a clear yes before applying. Annual leave within your balance is approved immediately.",
    "hours": "The Cedar Group HR desk is open Monday through Friday, from 9 AM to 5 PM Eastern Time."
  }
}'

echo "KV seeded successfully."
