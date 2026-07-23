# Edge-Cloud Development Stage Design

> **Status:** Approved / Implemented
> **Date:** 2026-07-23  
> **Depends on:** [Edge-cloud AI R&D platform](../../architecture/edge-cloud-ai-rd-platform.md), [Edge-cloud foundation plan](../plans/2026-07-22-edge-cloud-foundation.md) Tasks 9–12, [Web local IDE launch](./2026-07-16-web-local-ide-launch-design.md), [Local execution handoff](./2026-06-03-local-execution-handoff-design.md), OpenDesign design-stage implementation  
> **Constraint:** Approach C — long-lived stability without cloning the OpenDesign `active-design` session protocol for development

## 1. Goal

Finish the development-stage half of the edge-cloud foundation: Cursor/Codex Tool Adapters, a single server-side local completion command exposed through ExecutionSession APIs, MCP/Extension migration onto that protocol, Web session/Evidence visibility, and golden-path plus rollout coverage.

After this work:

```text
FlowX Web claims / issues launch ticket
  → flowx-local redeems ticket
  → CursorAdapter | CodexAdapter opens IDE with Skill + MCP + prompt
  → Agent develops and reports via MCP
  → POST /execution-sessions/:id/complete (LocalCompletionReport)
  → remote verify + Artifact/Evidence + workflow → Review
```

`claim-local` / `complete-local` remain compatible entry points. No `active-execution.json`.

## 2. Non-goals

- OpenDesign-parity active execution session files under `~/.flowx/`
- Device long-lived credentials or automatic token refresh
- Auto `git push` or unattended completion without Agent/MCP/Web action
- Removing Cursor Extension or deleting `claim-local` / `complete-local`
- Full Test Plan / MinIO / multi-center navigation rebuild
- SSE/WebSocket event streaming (v1 uses low-frequency refresh)
- First-class `terminal` Adapter capability (deferred)

## 3. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Delivery scope | Foundation Tasks 9→12 in one design, split PRs | Matches approved plan order without expanding into design-stage isomorphism |
| Session discovery | Inject `executionSessionId` in redeem/handoff/prompt; optional later `.flowx/task.json` | Development launch already targets a repo; OpenDesign needed `active-design.json` because the tool picks its own project directory |
| Completion authority | One `LocalCompletionCommand`; session complete is primary; `complete-local` wraps it | Today session `complete` only flips session status; making MCP prefer it without workflow advance would break the golden path |
| Adapter boundary | Adapters open tools and prepare context; they do not mutate workflow state | Same SPI rule as OpenDesignAdapter |
| Offline | Reuse flowx-local Outbox; avoid a third draft store in the Extension when possible | One retry surface, shared with design submit |

Correction valve: if Agents still cannot reliably obtain `executionSessionId` after handoff/prompt injection, add a minimal repo-local pointer (for example `.flowx/task.json`). Do not copy the full design active-session credential protocol until device credentials exist.

## 4. Architecture

### 4.1 Responsibility split

| Object / component | Responsibility |
| --- | --- |
| `WorkflowRun` / `StageExecution` | Business stage and human confirmation |
| `ExecutionSession` | One Cursor/Codex local execution lifecycle and `traceId` |
| `SyncEvent` / `Artifact` / `Evidence` | Progress and proof (git, tests, remote verification) |
| Tool Adapter | Open IDE / tool, ensure Skill+MCP, hand off context |
| MCP / Web / Extension | Call Edge/session APIs; never reimplement state machine |
| `LocalCompletionCommand` | Single server implementation for verify → artifacts → session terminal → workflow advance |

### 4.2 Target flow

```text
Web
  claim-local (creates/continues ExecutionSession)
  issue local-launch ticket
       │
       ▼
flowx-local /launch
  redeem ticket
  AdapterRegistry.resolve(cursor|codex)
  adapter.launch → ensureProject, writePromptFile, open IDE
       │
       ▼
Agent (MCP)
  flowx_collect_git_report
  flowx_report_progress? / flowx_report_evidence?
  flowx_report_completion → session complete (fallback complete-local)
       │
       ▼
API LocalCompletionCommand
  push/remote tip checks
  stage output + Artifact/Evidence
  idempotent session COMPLETED
  workflow → Review
```

## 5. Task 9 — Adapter SPI and launch refactor

### 5.1 Layout

```text
packages/flowx-local/src/adapters/
  tool-adapter.ts
  adapter-registry.ts
  open-design-adapter.ts   # existing
  cursor-adapter.ts        # new
  codex-adapter.ts         # new
```

### 5.2 Capabilities

| Capability | Cursor | Codex | OpenDesign |
| --- | --- | --- | --- |
| `repo-open` | yes | yes | no |
| `chat-handoff` | yes | yes | no |
| `context-import` | no | no | yes |
| `artifact-export` | no | no | yes |
| `completion-report` | yes (MCP/Web/Outbox; adapter does not complete workflow) | same | yes |

Expand `TOOL_ADAPTER_CAPABILITIES` accordingly. Keep OpenDesign capabilities working.

### 5.3 `launch.ts`

Thin orchestrator only:

1. Validate ticket + `apiBaseUrl`
2. Redeem `local-launch`
3. Resolve repo path
4. `registry.resolve(ide).launch(...)`
5. Return compatible result: `gitRoot`, `ide`, `prefilled`, `promptPath`, and `executionSessionId` when present

HTTP `/launch` request/response stays compatible for Web. `open-ide.ts` becomes an implementation detail of Cursor/Codex adapters.

### 5.4 CursorAdapter / CodexAdapter

- Reuse `ensureProject`, `writePromptFile`, IDE open, clipboard best-effort
- Require `workflowRunId` and `executionSessionId` from redeem/handoff; fail clearly if missing when session projection is enabled
- Do not write `~/.flowx/active-execution.json`
- Do not call workflow complete APIs
- Optional later: emit `execution.started` via EdgeClient/Outbox behind feature flag

### 5.5 Registry

- `cursor` / `codex` serve `/launch`
- `opendesign` continues on existing open-design routes
- Unknown tool names fail explicitly

### 5.6 Acceptance

- Existing launch tests and Web local IDE launch UX do not regress
- Cursor and Codex receive the same redeem handoff context version
- New adapters register without rewriting launch orchestration

## 6. Task 10 — Completion protocol and MCP / Extension

### 6.1 Problem to fix

`complete-local` already verifies remotes, writes artifacts, dual-writes the session, and advances review.  
`POST /execution-sessions/:id/complete` currently only transitions session status. MCP must not “prefer” the thin endpoint until it runs the same command.

### 6.2 Single command, two HTTP entries

**Canonical:** `LocalCompletionCommand` on the API.

| Entry | Role |
| --- | --- |
| `POST /execution-sessions/:id/complete` | Primary. Body = `LocalCompletionReport` |
| `POST /workflow-runs/:id/execution/complete-local` | Compatibility. Resolve active LOCAL session for the run, then delegate to the same command |

OpenDesign `.../design/complete` and brainstorm complete remain separate product-shaped endpoints. Development uses the generic session complete path.

### 6.3 `LocalCompletionReport` (SSOT in `@flowx-ai/protocol`)

- `idempotencyKey` (required)
- `summary` / `implementationSummary` / `testResult`
- `pushed`
- `diffSummary` / `untrackedFiles` (optional)
- `repositories[]`: `workflowRepositoryId`, `headSha`, `changedFiles`, `patchSummary?`
- `metadata?`

Align `CompleteLocalExecutionDto` and the session complete DTO with this type so fields do not fork.

### 6.4 MCP tools

| Tool | Behavior |
| --- | --- |
| `flowx_collect_git_report` | Unchanged |
| `flowx_report_progress` | New → `POST /execution-sessions/:id/events` (`execution.progressed`) |
| `flowx_report_evidence` | New → register Evidence for the session |
| `flowx_report_completion` | Prefer session complete; accept optional `executionSessionId`; if missing, use id injected by Skill/prompt/handoff; if still missing, fall back to `complete-local` with an explicit warning |

Skill and prompt templates must instruct Agents to pass `executionSessionId` and `workflowRepositoryId`.

### 6.5 Cursor Extension

- Persist `executionSessionId` from handoff/claim
- Report completion via session complete when available
- If the server lacks the protocol version: return a clear `PROTOCOL_VERSION_UNSUPPORTED` style error — no silent completion downgrade
- When API is unreachable: prefer flowx-local Outbox (or a documented Extension draft that drains through the same Outbox) — do not invent a third long-term store

### 6.6 Errors and idempotency

Stable codes at least:

- `REMOTE_BRANCH_NOT_VERIFIED`
- `EXECUTION_SESSION_TERMINAL`
- `EXECUTION_SESSION_CONFLICT`
- `PROTOCOL_VERSION_UNSUPPORTED`
- `EDGE_REPOSITORY_MISMATCH`

Same `idempotencyKey` returns the first successful completion result. Completion after cancel must not advance the workflow.

### 6.7 Acceptance

- MCP and Extension tests stay green; add session-primary path coverage
- Compatibility matrix for old/new APIs is automated
- Feature flags can disable new client paths without breaking `complete-local`

## 7. Task 11 — Web session and Evidence panel

On workflow detail, EXECUTION stage:

- Keep existing local launch and complete-local UI
- Add read-only `ExecutionSessionPanel` when `executionSessionId` is available:
  - status, `sourceTool`, device, `traceId`, last heartbeat
  - recent events (manual refresh or ≤30s polling with the page)
  - Evidence list: git commit, changed files, remote verification, test result, agent summary
- Hide the panel when session projection is off or id is absent — no hard errors
- Extend `apps/web/src/api.ts` with session/events/evidence clients and tests first
- No SSE/WebSocket in this tranche

## 8. Task 12 — Golden path and rollout

### 8.1 Automated scenarios

1. Requirement: Web ticket → Cursor Adapter → MCP session completion → Review
2. Bug: Codex path equivalent
3. API offline: progress/completion enter Outbox; `flowx-local sync` replays idempotently
4. Lost completion response retried with the same `idempotencyKey`
5. Missing push / remote tip mismatch → recoverable failure, no false advance
6. Cancel then stale completion → rejected
7. Legacy Extension via `complete-local` still succeeds

### 8.2 Rollout order

1. Ship `LocalCompletionCommand` + session complete body; UI may still call `complete-local`
2. Point MCP / new Extension at session complete by default
3. Enable Web session panel
4. Document session API as default after observation; flags remain for rollback

### 8.3 Docs to update

- `docs/edge-agent-operations.md`
- `docs/web-local-ide-launch.md`
- `docs/local-execution-handoff.md`
- Cross-link from foundation plan Task 9–12 checkboxes when implementing

Call out explicitly: development has no active-execution file; completion is keyed by `executionSessionId`; `complete-local` is a compatibility wrapper.

## 9. PR split

Aligned with foundation plan PR 3–5:

| PR | Contents |
| --- | --- |
| PR A | Task 9 — Adapter SPI, Cursor/Codex adapters, thin `launch.ts` |
| PR B | Task 10 — `LocalCompletionCommand`, protocol DTO alignment, MCP + Extension |
| PR C | Task 11–12 — Web panel, golden-path tests, ops docs, rollout notes |

High-risk areas (`workflow`, Prisma if touched, `apps/web/src/api.ts`) require tests before implementation.

## 10. Definition of done

- Cursor and Codex start through Adapter Registry without UX regression
- Exactly one server-side local completion implementation advances both session and workflow
- MCP progress / evidence / completion work and are idempotent
- Web can inspect the active session and key Evidence
- Legacy Extension and `complete-local` remain usable
- Feature flags can roll back new client defaults
- `pnpm check` passes

## 11. Out of scope follow-ups

- Minimal `.flowx/task.json` session pointer (only if correction valve trips)
- Device credentials and token auto-refresh
- `terminal` capability and richer IDE prefill
- SSE/WebSocket session event stream
- Unifying design complete into the same generic complete body (keep design-shaped endpoints for now)
