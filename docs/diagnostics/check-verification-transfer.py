"""Check sanitized call evidence for verification followed by a manager transfer.

This checks a captured voice-call sequence. It does not run the model or prove
that an untested prompt/configuration change fixes a future call.
"""

import json
from pathlib import Path
import sys


def main():
    evidence = json.loads(Path(sys.argv[1]).read_text())
    events = evidence["events"]
    verified = next(
        (event for event in events
         if event["kind"] == "tool_result"
         and event.get("tool") == "verify_employee"
         and event.get("explicit_ok_true")),
        None,
    )
    if verified is None:
        print("INCONCLUSIVE: no successful verification in the supplied evidence")
        return 2

    next_call = next(
        (event for event in events
         if event["kind"] == "tool_call"
         and event["index"] > verified["index"]
         and not event["tool"].startswith("transition__")),
        None,
    )
    if next_call is None:
        print("INCONCLUSIVE: no business tool call after verification")
        return 2

    expected_node = evidence["expected_manager_node"]
    passed = (
        next_call["tool"] == "transfer"
        and next_call.get("node_from_flow_metadata") == expected_node
    )
    print("Successful verification: yes")
    print("Next business tool:", next_call["tool"])
    print("Workflow node:", next_call.get("node_from_flow_metadata"))
    print("PASS" if passed else "FAIL: expected manager transfer before any business lookup")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
