# Product Requirements Document — HR Leave Assistant

Version 3.0 · 2026-11-12 · Status: scope for a three-day build (Thu 12 – Sat 14 Nov 2026). Nothing is built yet.

Revision 3.0 changes the use case from an appointment receptionist to an HR leave assistant. Revision 2.0 (the receptionist) is kept in [archive/v2.0-receptionist/PRD.md](archive/v2.0-receptionist/PRD.md) and revision 1.1 in [archive/v1.1/PRD.md](archive/v1.1/PRD.md).

Assignment: `80639ad328bdbbcf732cba72559c894a/code_challenge.md`. How it is built: [TDD.md](TDD.md) (Technical Design Document). Platform facts: [TELNYX_PLATFORM_RESEARCH.md](TELNYX_PLATFORM_RESEARCH.md).

## 1. Purpose

Employees ask the HR desk the same few questions by phone: how many annual leave days do I have left, can you put me down for these days, please cancel that request. Build an English phone assistant that lets an employee call, prove who they are, hear their annual leave balance, apply for leave, and cancel leave, and that hands over to the HR team through a callback request when it cannot finish. It exists to satisfy the Telnyx coding challenge, so every mandatory requirement must be demonstrably met on demo day with real evidence.

Confirmed choices: HR leave assistant (balance, apply, cancel), English, TypeScript. The company, Cedar Group, and every employee are fictional and all data is synthetic.

## 2. Challenge requirements and how each is met

| # | Requirement | Met by | TDD |
| --- | --- | --- | --- |
| 1 | Assistant with a multi-node Conversation Workflow, a speak node, conditional edges, a phone number | Eleven nodes: two speak, nine prompt; LLM edges for intent, variable edges for backend facts | §6 |
| 2 | Custom MCP server with at least three tools | Seven tools: leave policy, verify employee, leave balance, preview leave, apply leave, cancel leave, HR callback | §7 |
| 3 | Dynamic webhook variables that personalize and route | Signed webhook returns eight variables; two drive routes, one changes the greeting, two give the model today's date | §5 |
| 4a | Edge Function deployed with `telnyx-edge ship` | One application serves the webhook and the MCP server | §4 |
| 4b | Telnyx KV for cache, session, or flags | Leave-changes pause flag and the company leave policy | §8.4 |
| 4c | Stateful Actor with a read-modify-write | Per-employee leave balance with atomic apply and cancel, and PIN-attempt lockout; per-caller call counter | §8.1–8.2 |
| 5 | Structured logs, one more signal, one-minute detection, a real debugging story | JSON logs with a per-call ID, platform metrics, actor counters, a 15-second probe, an incident file | §10 |
| 6 | Built with Telnyx Inference through OpenCode | The developer builds with the OpenCode coding agent on a Telnyx-hosted model, which writes all solution code. Claude Code reviews each slice and writes none. Sessions and reviews are logged | §14.2 |
| 7 | Public deployment and documentation | Number, URLs, README with a synthetic test employee, demo script, OpenCode config | §§14–15 |

## 3. Scope

### 3.1 Tiers

| Tier | Contents | Rule |
| --- | --- | --- |
| **Must** | Everything in §2, the journeys in §5, the requirements in §6, the evidence in §8 | Never cut. Finished before anything else starts. |
| **Should** | Live transfer to the HR team during open hours; escalation after five minutes | Day 3, only when Must is green. |
| **Stretch** | Log export to a hosted viewer (`telnyx-edge log-export`) | Only with time left after Should. |

Cut order when behind: Stretch, then transfer, then the five-minute escalation, then the degraded-context node. A Must item is never traded away.

Challenge bonus items that the Must tier already produces, claimed only with evidence: variable comparison edges, KV feature flags, custom webhook variables that route, and correlation of one call across components by a shared ID. The challenge's own "Verification Flow" idea (verify, then route, with an actor counting attempts) is the model for the sign-in step. Not attempted: multi-assistant routing, actor alarms, object storage, shared actors.

### 3.2 Out of scope

Leave types other than annual leave; half days; carry-over; editing a request (cancel and re-apply instead); manager approval; team coverage limits; payroll; SMS or email confirmations; an HR system of record; several companies or time zones; other languages; staff sign-in and a dashboard; real employee data. A caller who asks for any of these is offered a callback. The archived revisions hold designs for production hardening, and TDD §16 lists what was never designed.

## 4. Demo company

| Item | Value |
| --- | --- |
| Name | Cedar Group (fictional), HR desk |
| Time zone | `America/New_York`, always stated by the company, never guessed from the caller's number |
| HR desk hours | Monday–Friday, 09:00–17:00. They change callback wording only; the assistant answers at any hour |
| Leave policy | Annual leave only; 14 days per leave year; leave year 1 July 2026 – 30 June 2027; whole days only |
| Counting | Monday–Friday, excluding company holidays (26 Nov 2026, 25 Dec 2026, 1 Jan 2027) |
| Request rules | First day at least one day after today; both dates inside the leave year; at most 10 working days per request; no overlap with approved leave; cannot exceed the remaining balance |
| Approval | Annual leave within the balance is approved immediately and the caller is told so. Manager approval is out of scope |
| Cancelling | Approved leave that has not started; the days return to the balance |
| Identity | A four-digit employee number and a four-digit PIN, given on the call. Caller ID never identifies an employee. Three wrong PINs lock that employee for 15 minutes. A number that has called before earns "Welcome back." and nothing else |
| Employees | Four synthetic: 1001 Alex Rivera (8 days left), 1002 Priya Nair (2 left), 1003 Sam Okafor (5 left), 1004 Jordan Lee (14 left). PINs are in `src/config/default-employees.ts`; the README lists one for graders |

## 5. Caller journeys

1. **Balance.** Disclosure → the caller wants their balance → employee number and PIN → "Hello, Alex." → remaining days and any upcoming leave spoken.
2. **Apply.** Verified → the caller wants leave → first and last day → the working days counted and days left spoken → readback → a clear yes → approved, reference spoken.
3. **Cancel.** Verified → upcoming leave listed → the caller names which by its first day → readback with the days that will be restored → a clear yes → cancelled, new balance spoken.
4. **Policy, then personal.** The caller asks about notice or holidays, gets an answer from approved policy, then continues to their balance without repeating themselves. Policy needs no sign-in.
5. **Sign-in fails.** Wrong employee number or PIN: told it did not match, with tries left. Three wrong PINs: told the account is locked for now and offered an HR callback. No answer reveals whether an employee number exists.
6. **Changes paused.** The operator has switched leave changes off. A caller who asks to apply or cancel hears a fixed notice and is offered a callback. Balance enquiries still work.
7. **Reach a person.** The caller asks for a person at any point and is taken to a callback request. Outside HR desk hours they are told the team will call on the next business day.
8. **Something is broken.** If call context could not be loaded, the assistant says leave services are unavailable right now and ends politely. It never pretends.

Voice rules: one question per turn; short sentences; dates spoken as weekday, month, and day; never say the PIN aloud; read the employee number back only to confirm a mishearing; a correction restarts the readback; silence or "no" never changes anything; after two attempts at the same detail that could not be heard or understood, offer a callback (a clearly heard wrong PIN counts toward the lockout instead); no internal terms spoken to callers.

## 6. Functional requirements

| ID | Requirement | Acceptance |
| --- | --- | --- |
| FR-01 | Reachable by phone | An outside caller dials the published number and reaches the assistant. |
| FR-02 | Fixed disclosure | The opening names the company's HR desk and says it is an AI, word for word, on every call. |
| FR-03 | Personalized opening | A number that has called before hears "Welcome back."; a new number does not. No name, balance, or count is spoken before sign-in. |
| FR-04 | Approved policy answers | Entitlement, notice, holidays, process, and HR hours answers come from the policy tool. Unknown questions are admitted, not invented. |
| FR-05 | Sign-in | Personal leave data is given only after a valid employee number and PIN. Three wrong PINs lock the employee for 15 minutes, counted exactly even under parallel guesses. Every later tool call is tied to the verified employee by a signed token; no tool accepts another employee number. |
| FR-06 | Balance | The caller hears entitlement, days used, days remaining, and upcoming approved leave. |
| FR-07 | Apply | Offered dates are checked against the leave year, notice, holidays, the 10-day limit, overlap, and balance. The working days are counted by the system, not the model. Dates and days are read back and a clear yes is required before applying. |
| FR-08 | Cancel | The caller can cancel approved leave that has not started. The days return to the balance once, however many times the request is repeated. |
| FR-09 | No overspend, no duplicates | Parallel requests can never take the balance below zero or hold overlapping leave. A repeated confirmation returns the same reference and creates nothing new. |
| FR-10 | Honest outcome | "Approved", "cancelled", and "queued" are spoken only after the tool returns `approved`, `cancelled`, or `queued` with a reference. A refusal says why. |
| FR-11 | Routing on backend facts | Paused changes and missing context each change the path without any prompt change. |
| FR-12 | Callback | A caller who wants a person, cannot sign in, or cannot be helped can leave name, number, and reason. Success is spoken only after it is saved. No sign-in is needed. |
| FR-13 | Operator view and control | The operator can list leave requests and balances and callbacks, read outcome counters, pause and resume leave changes without a redeploy, and reset demo data. |
| FR-14 | Privacy | Caller ID never reveals leave data. Logs hold no raw phone number, employee number, PIN, name, token, or request body. |

## 7. Quality requirements

| ID | Requirement | Target |
| --- | --- | --- |
| NFR-01 | Correctness | Zero negative balances, zero overlapping leave, and zero duplicate requests in the concurrency test and in all demo calls. A request survives a redeploy. |
| NFR-02 | Responsiveness | The webhook answers inside its configured timeout, including a cold start. Measured, reported, not assumed. |
| NFR-03 | Safe failure | Each failure in TDD §11 produces its stated caller behavior. No failure produces a false "approved" or "cancelled". |
| NFR-04 | Detection | A backend outage (function, KV, actor, MCP) raises an alert within 60 seconds in a timed drill. Voice-path faults are found by a smoke call after each deployment. The README states both. |
| NFR-05 | Security | TDD §9 holds before the number is shared. |
| NFR-06 | Maintainability | Typed, formatted, small modules; setup reproducible from the README by another engineer. |
| NFR-07 | Cost | A spending ceiling is agreed before the first billable step; the probe stops when the evaluation window closes. |

## 8. Acceptance scenarios

| ID | Scenario | Expected | Evidence |
| --- | --- | --- | --- |
| A-01 | Balance after sign-in | Employee 1001 hears 8 days remaining | Phone call + `/admin/requests` |
| A-02 | Apply for available days | Approved, reference spoken, balance reduced by the working days | Phone call + `/admin/requests` |
| A-03 | Cancel upcoming leave | Cancelled, days restored | Phone call + `/admin/requests` |
| A-04 | Correction before yes | Old dates are not applied; the new readback is | Phone call |
| A-05 | "No" at confirmation | Nothing written | Phone call + `/admin/requests` |
| A-06 | Three wrong PINs | Locked, HR callback offered and saved | Phone call + `/admin/callbacks` |
| A-07 | Policy question, then balance | Approved answer without sign-in, then balance without repeated questions | Phone call |
| A-08 | Leave changes paused | Fixed notice, then callback saved; balance still works | Phone call after a KV write, no deployment in between |
| A-09 | Ask for a person | Callback saved, reference spoken | Phone call + `/admin/callbacks` |
| A-10 | Same number calls twice | Second call hears "Welcome back." | Two phone calls |
| A-11 | Context unavailable | Degraded message, no leave action attempted | Phone call with the webhook URL pointed away |
| A-12 | Twenty parallel one-day applies, five days of balance (employee 1003) | Exactly five approved; balance ends at zero, never negative | Deployed test |
| A-13 | Same apply twice | Same reference, one request | Deployed test |
| A-14 | Two parallel cancels of one request | One cancelled, one replay; balance restored once | Deployed test |
| A-15 | Ten parallel wrong PINs (employee 1004); four attempts on a number that is not on the roster | Exactly three `auth_failed`, seven `locked`; the unknown number shows the same countdown and lock | Deployed test |
| A-16 | Invalid requests: past dates, weekend-only or holiday-only range, outside the leave year, over ten days, overlap with approved leave, more than the balance (employee 1002) | Each refused with its reason; balance unchanged | Deployed test |
| A-17 | Two calls at once from one number | Count rises by two | Deployed test |
| A-18 | Request survives a redeploy | Still listed, balance unchanged | Deployed test |
| A-19 | Backend outage | Alert within 60 seconds; failing dependency named | Timed drill |
| A-20 | Unauthenticated access | `/mcp` and `/admin` refuse without a bearer; an employee tool without a valid token, or with a token from another conversation, returns `unauthenticated` | Deployed test |

## 9. Three-day plan

| Day | Outcome | Exit evidence |
| --- | --- | --- |
| **Thu 12** | Repository created. Edge CLI installed. Actor scaffold shipped. Webhook with structured logs, `CallerProfile`, and the KV read. A two-node assistant on a real number. One MCP tool executed from a call (`get_leave_policy`). Account checks C-1 to C-5 answered. | A call that is greeted using webhook data and runs `get_leave_policy`. Second call hears "Welcome back." |
| **Fri 13** | `EmployeeLeave`, `HrDesk`, and the leave rules with unit tests. Session token and sign-in. The remaining six tools. The full eleven-node workflow with tools scoped per node. Pause flag. Admin routes. C-7 on the first sign-in call. One call through each journey. | A-01 to A-11 pass by phone. |
| **Sat 14** | Deployed tests A-12 to A-20. Probe and timed outage drill. Should-tier items if green by midday. README, DEMO.md, incident record, DEVLOG, exported assistant JSON. Two timed rehearsals. | Every row of TDD §15 has evidence. |

Standing rules for all three days: log from the first endpoint; make a real call after every deployment that changes behavior; write the incident file the day the bug happens; commit after each working slice; have Claude Code review each committed slice, and have OpenCode fix blocking findings before the next slice starts (TDD §14.2).

## 10. Demo day

**Live demo, 8–10 minutes.**

| Time | Show |
| --- | --- |
| 0:00 | The company, the caller, the number. Show the deployed function with `telnyx-edge list`. Start `telnyx-edge logs --tail` and the probe on screen. |
| 1:00 | Call as employee 1001: disclosure, a policy question, sign-in, balance, then apply for leave. Point at the tool log lines as they appear, then `/admin/requests`. |
| 4:00 | Call again from the same phone: "Welcome back." Cancel the leave; hear the balance return. Show the caller count in the logs. |
| 5:00 | `kv key put flags/leave_changes_enabled false`, call, hear the paused notice, leave a callback. No deployment happened. |
| 6:30 | Run `race.sh`: twenty applies, five winners, balance never below zero; ten wrong PINs, three counted. Show `/admin/stats` and `telnyx-edge metrics`. |
| 8:00 | `trace.sh <call_ref>` for the first call. Then the real incident: the signal, the cause, the fix. |

**Walkthrough, 7–10 minutes.** Why this use case; node and edge design; why every node appends to the assistant instructions instead of replacing them; why variable edges for facts and LLM edges for intent; the seven tools; how sign-in works and why no tool takes an employee number after it; what the variables do; Function versus KV versus Actor for each piece of state (TDD §3.1); how the project was built: the OpenCode coding agent on a Telnyx-hosted model wrote the code and Claude Code reviewed it, which model was used, and what it did well or badly; the hardest bug and the signal that exposed it; what was cut for time and how it would be hardened, starting with a one-time code in place of a spoken PIN.

**Q&A, 5 minutes.**

## 11. Submission checklist

- [ ] GitHub repository David owns, with the complete solution and no secrets.
- [ ] Working phone number and test instructions, including one synthetic employee number and PIN for graders. The README says that grader state is shared (any caller can spend employee 1001's balance or lock it for 15 minutes), and David runs `POST /admin/reset` before the evaluation window.
- [ ] Live URLs for the webhook and the MCP server.
- [ ] README: setup, architecture diagram, how to test, observability and debugging story, one-minute detection and its limits, known limitations (spoken PIN is demo-grade identity).
- [ ] DEMO.md: the timed script above.
- [ ] `.opencode/opencode.json` showing the Telnyx plugin, and the DEVLOG with model IDs and review lines. The README states that OpenCode built the solution and Claude Code reviewed it.
- [ ] `assistant/assistant.json`: the saved workflow.
- [ ] Incident record for one real bug.
- [ ] Evidence for every row of TDD §15.

Boxes stay empty until real evidence exists.

## 12. Risks

| Risk | Response |
| --- | --- |
| A platform feature behaves differently from the documentation | Seven time-boxed checks with fallbacks, five of them on day 1 (TDD §13). |
| The account lacks credit, a number, or actor access | Confirm first thing on day 1; contact the challenge organizer the same hour. |
| The hosted coding model produces weak code | Small slices, each shipped and verified before the next; a Claude Code review of every committed slice; switch between enabled Telnyx-hosted models; record what happened in the DEVLOG. |
| The model changes leave without a clear yes | Readback, apply and cancel each scoped to one node, and call tests for "no" and corrections. |
| The model counts working days wrong | The system counts them; `apply_leave` never accepts a day count. |
| One employee's data reaches another | No tool takes an employee number after sign-in; the signed token carries identity; tested in A-20. |
| Speech recognition garbles a digit | Digits one at a time, employee number read back, two unclear attempts lead to a callback (check C-7). A garbled PIN that reaches the system counts as a failed attempt. |
| A spoken PIN is weak identity | Stated limitation; lockout and logging controls; synthetic data only; one-time code is the hardening path. |
| A demo-day outage | Smoke call and probe before the session; rollback command ready; recorded evidence of every scenario as a backup. |
| Running out of time | The cut order in §3.1. |
