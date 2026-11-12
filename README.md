# Telnyx coding challenge — HR leave assistant

**Status: planning, 2026-11-12.** No source code, deployment, phone number, or test result exists yet. Build days are Thu 12 – Sat 14 Nov 2026. This file is a placeholder index; the submission README (setup, architecture, usage, observability and debugging story) replaces it once real evidence exists.

On 2026-11-12 the project changed from an appointment receptionist to an HR leave assistant. The earlier documents are in [docs/archive/v2.0-receptionist/](docs/archive/v2.0-receptionist/).

## What is being built

An English-speaking AI phone assistant for the HR desk of one fictional company. An employee calls, signs in with an employee number and PIN, and hears their annual leave balance. They can also ask the assistant to apply for leave or cancel leave. The assistant answers approved leave-policy questions without a sign-in and takes an HR callback request when it cannot finish. It runs as a Telnyx AI Assistant with an eleven-node Conversation Workflow, backed by one TypeScript application on Telnyx Edge Compute that serves the dynamic-variables webhook and a seven-tool MCP server, using Telnyx KV and three Stateful Actors (one per employee for balances and sign-in attempts, one per caller, one for the HR desk).

## How it is built

The developer builds the project with the **OpenCode coding agent** and the `@telnyx/opencode` plugin, on a Telnyx-hosted model. OpenCode writes all solution code, as the challenge requires. **Claude Code reviews** each committed slice against the design and writes no solution code; it also produced the planning documents. Each OpenCode session and each review is recorded in `docs/DEVLOG.md`. Details: [docs/TDD.md](docs/TDD.md) §14.2.

## Documents

| Document | Purpose |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | What is built: scope and tiers, requirements, acceptance scenarios, three-day plan, demo script. |
| [docs/TDD.md](docs/TDD.md) | How it is built: architecture, workflow graph, sign-in, tools, state, security, observability, tests, day-1 runbook. TDD means Technical Design Document. |
| [docs/MCP_SERVER_SPEC.md](docs/MCP_SERVER_SPEC.md) | Build spec for the `/mcp` route. |
| [docs/TELNYX_PLATFORM_RESEARCH.md](docs/TELNYX_PLATFORM_RESEARCH.md) | Platform facts and their sources. |
| [docs/DEVLOG.md](docs/DEVLOG.md) | Build sessions, reviews, and verification results. |
| [AGENTS.md](AGENTS.md) | Build rules for the OpenCode coding agent, the builder. |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code, the reviewer. |
| [docs/archive/](docs/archive/) | Superseded designs: `v1.1` (one-week appointment design) and `v2.0-receptionist` (three-day appointment design). |
| `80639ad328bdbbcf732cba72559c894a/code_challenge.md` | The assignment from Telnyx, unmodified, in a clone of the challenge gist. |

## Before the first build session

1. Make this directory a git repository David owns; git-ignore the gist clone (TDD §14.3).
2. Confirm the Telnyx account, credit, and a spending ceiling.
3. Install the `telnyx-edge` CLI. OpenCode with `@telnyx/opencode` is already configured in `.opencode/`.
# HR_AI_Assistant
