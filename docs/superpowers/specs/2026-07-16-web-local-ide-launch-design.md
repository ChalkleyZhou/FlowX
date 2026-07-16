# Web Local IDE Launch — Design Spec

> **Status:** Approved for planning  
> **Date:** 2026-07-16  
> **Depends on:** [Local Execution Handoff](./2026-06-03-local-execution-handoff-design.md), [Cursor Plugin Local Chat](./2026-06-04-cursor-plugin-local-chat-workflow-design.md), existing `packages/flowx-mcp`  
> **Goal of v1:** Ship a thin path that proves the interaction — click in Web, open Cursor or Codex locally with task context — before polishing edge cases.

## Problem

The Cursor / VS Code extension path for local execution works but feels heavy: sign-in inside the IDE, task picker in a side bar, manual MCP setup, and fragile Chat open commands. Developers already manage workflows in FlowX Web; they want to **start local work from the browser** and land in Cursor or Codex with enough context (Skill + MCP + prompt) to run and report completion.

## Goals

| Goal | Measure |
|------|---------|
| Web-first entry | From a workflow run in `EXECUTION_PENDING` (or already local-claimed), user can click **本地启动** and choose Cursor or Codex |
| Local bridge | A loopback `flowx-local` process owns filesystem writes and process launch |
| Repo resolution | Known `repoUrl → path` mapping opens immediately; unknown path prompts once and is remembered |
| Skill + MCP ready | Launch ensures FlowX Skill and MCP config exist for the target repo (or user config) before opening the IDE |
| Prompt delivery | Best-effort auto-open Chat/Agent with prompt; otherwise write `.flowx/tasks/<id>.md` and copy to clipboard |
| State parity | Still uses `claim-local` / `local-handoff` / `complete-local`; API remains source of truth |
| Thin v1 | One happy path works end-to-end so the team can judge UX before deepening IDE integrations |

## Non-goals (v1)

- Replacing or removing the Cursor extension (it remains an optional fallback)
- Auto-cloning repositories
- Auto `git push` or unattended completion without Agent/MCP (or Web complete-local fallback)
- Perfect Chat prefill parity across Cursor and Codex
- Multi-repo parallel one-click orchestration beyond passing all handoff repos to the bridge
- Background auto-update of the local bridge
- Full redesign of LOCAL_CHAT task picker (full workflow local execution is the primary v1 entry)

## Chosen approach

**Lightweight local bridge + reuse existing APIs** (not “deep link into extension only”, not “copy script only”).

- Primary: `flowx-local` CLI/daemon on loopback  
- Enhancement: product deep links (`cursor://…`, `codex://…`) when available  
- Fallback: CLI open folder + prompt file + clipboard  

## Architecture

```text
FlowX Web                    flowx-local (本机桥)              Cursor / Codex
─────────                    ──────────────────              ──────────────
选 IDE / 点本地启动    →     loopback HTTP API
claim-local (existing) →     resolve repo path
issue launch ticket    →     ensure Skill + MCP
                           →  deep link or CLI open IDE
                           →  prefill prompt (else copy)
                                                      →  Agent uses MCP
                                                      →  flowx_report_completion
```

Principles:

1. **Web** orchestrates entry and IDE choice; never writes local files or spawns IDEs directly.  
2. **flowx-local** is the only component that may write machine files and open processes.  
3. **Skill + MCP** are the in-IDE work surface; the extension is optional.  
4. **FlowX API** remains the workflow state machine; MCP stays a thin bridge.

## Components

| Component | Responsibility | Must not |
|-----------|----------------|----------|
| Web「本地启动」 | Choose Cursor/Codex; `claim-local` (or reuse handoff if already local); call `flowx-local` `/launch` with ticket + IDE + repo URLs | Write disk; spawn IDE |
| API (small addition) | Reuse claim/handoff/complete; issue short-lived **launch ticket** bound to user + run | Scan local paths; install skills |
| `flowx-local` (new) | Loopback daemon; repo map; path picker; ensure Skill/MCP; open IDE; best-effort prompt inject | Reimplement state machine; full plugin UI |
| FlowX Skill (thin) | Instruct Agent: read handoff, use working branch, call MCP tools, report completion | Call FlowX HTTP directly |
| `flowx-mcp` (existing, small adds) | Keep list/context/git/report; add handoff fetch if needed for Agent | Open IDE |
| Cursor extension | Optional fallback for users who already use it | Block the new path |

Local config (indicative):

- `~/.flowx/local.json` — daemon port, repo URL→path map, default IDE preference  
- Target repo — `.cursor/skills/flowx-*/SKILL.md` (and equivalent Codex/agents paths as needed), project-level MCP config preferred  
- Target repo — `.flowx/tasks/<task-or-run-id>.md` prompt snapshot (same spirit as the extension handoff files)

## End-to-end data flow

1. User opens Workflow detail, clicks **本地启动**, selects Cursor or Codex.  
2. Web → API: `POST .../execution/claim-local` when status is `EXECUTION_PENDING`; if already local-running, skip claim and use existing handoff.  
3. Web → API: issue **launch ticket** (short TTL; bound to `userId` + `workflowRunId` + api base).  
4. Web → `http://127.0.0.1:<port>/launch` with `{ ticket, ide, repositories: [{ url, workingBranch, ... }] }`.  
5. `flowx-local`:  
   a. Exchange ticket with API for handoff + short-lived MCP credential  
   b. Resolve each repo path via map; if missing, native directory picker; remember selection  
   c. Ensure Skill + MCP config (write if absent; MCP env uses short-lived token)  
   d. Write `.flowx/tasks/<id>.md` (prompt + branch guidance)  
   e. Open IDE: prefer deep link, else CLI (`cursor <path>` / Codex equivalent)  
   f. Try Chat/Agent prefill; on failure, clipboard + Web toast  
6. Agent follows Skill; uses MCP (`flowx_collect_git_report`, implement, `flowx_report_completion`).  
7. API completes via existing `complete-local` path → review.

**Prerequisite:** User has installed and started `flowx local` at least once (or it is started by a documented one-shot command). If Web cannot probe the daemon, show install/start instructions instead of silent failure.

## Launch ticket (API contract sketch)

Purpose: avoid putting the user’s long-lived session token into browser→loopback payloads longer than necessary, and give the daemon a scoped credential to fetch handoff and configure MCP.

Indicative shape:

- `POST /workflow-runs/:id/execution/local-launch-ticket`  
  - Auth: existing session  
  - Returns: `{ ticket, expiresAt, loopbackHint? }`  
- Daemon redeems ticket against API (e.g. `POST /local-launch/redeem`) → `{ handoff, mcpToken, chatPrompt, apiBaseUrl }`  
- Ticket TTL: minutes-scale (e.g. 5 minutes); single-use or tightly rate-limited  
- Ticket must not grant unrelated admin powers; scope = this run’s local handoff + completion reporting for that user

Exact route names can be finalized in the implementation plan; behavior above is normative.

## flowx-local surface (v1)

CLI:

- `flowx local` / `flowx-local` — start daemon on loopback (fixed or configured port)  
- `flowx local setup` — optional one-shot: write user config, print Web pairing notes  
- `flowx local map <repoUrl> <path>` — optional manual mapping

HTTP (loopback only):

- `GET /health` — Web probe  
- `POST /launch` — body as above; performs resolve → ensure → open → prompt delivery  

Security baseline for v1:

- Bind to `127.0.0.1` only  
- Reject non-loopback hosts  
- Require valid launch ticket for `/launch`  
- Do not log raw tokens

## Skill + MCP ensure strategy

Order of preference:

1. If project already has FlowX Skill + MCP config pointing at a working `flowx-mcp`, leave them; refresh token/env if needed via ticket redemption.  
2. Else write thin Skill into the repo’s Cursor/agents skill path(s) from a template shipped with `flowx-local` or `packages/flowx-mcp`.  
3. Write/update project MCP config to run `flowx-mcp` with `FLOWX_API_BASE_URL` + short-lived token from redemption.  
4. Never commit secrets; token is env for the MCP process, not a file that should be git-added (gitignore `.flowx/credentials*` if any local cache is introduced later).

Auto-install is **bridge-mediated**, not “browser writes disk”.

## Error handling and degradation

| Situation | Behavior |
|-----------|----------|
| Daemon not reachable | Web shows install/start instructions + copyable command; do not claim success |
| Repo unmapped and user cancels picker | Abort launch; Web shows “未选择本地路径” |
| Deep link / Chat prefill fails | Still open repo folder; prompt on disk + clipboard; toast explains paste into Chat |
| Cursor vs Codex capability gap | Same handoff/Skill/MCP; prefill best-effort; shared fallback |
| `claim-local` fails | Existing API error UX; do not call daemon |
| Ticket expired/invalid | Daemon rejects; user retries from Web |
| MCP `report_completion` fails | Keep error/draft behavior; Web **完成本地执行** remains available |

## Web UX (v1)

On Workflow Run detail (execution stage):

- Primary control: **本地启动** with IDE choice (Cursor | Codex). This single action performs claim (when needed) + launch-ticket + daemon `/launch`.  
- Do not ship a second equally prominent **本地执行** button beside it. Branch/handoff guidance can still appear in the page after claim/launch.  
- After successful daemon accept: toast “已在本地打开 {IDE}”.  
- After daemon missing: inline callout with setup steps (copyable `flowx local` command).  
- Keep cloud **云端执行** unchanged and separate.  
- Keep **完成本地执行** / **取消本地执行** as fallbacks when MCP reporting is unavailable.

## Testing and acceptance

Automated:

- API: launch ticket issue + redeem + expiry/scope unit tests  
- `flowx-local`: repo map, skill/MCP ensure, launch orchestration with IDE open mocked  
- Web: probe miss vs successful `/launch` interaction tests  

Manual acceptance (v1 success bar):

1. Workflow at `EXECUTION_PENDING`  
2. Click **本地启动** → choose Cursor (and separately Codex)  
3. Correct local repo opens  
4. Prompt visible (Chat prefilled **or** file + clipboard)  
5. Agent can call MCP and complete via `flowx_report_completion` (or Web complete-local fallback documented)

## Relationship to existing docs

- [docs/local-execution-handoff.md](../../local-execution-handoff.md) — unchanged completion contract  
- [docs/cursor-plugin-local-chat.md](../../cursor-plugin-local-chat.md) — extension remains documented fallback; Web+bridge becomes preferred entry  
- [docs/cursor-mcp-setup.example.json](../../cursor-mcp-setup.example.json) — superseded for happy path by bridge-written config; keep as manual reference  

## Open points deferred to implementation plan

- Exact npm/pnpm package layout for `flowx-local` (new package vs under `packages/`)  
- Canonical Skill paths for Cursor vs Codex on disk  
- Whether Web stores a preferred IDE in user settings  
- Port selection / conflict handling for the daemon  
- Whether first daemon start can be triggered via custom protocol `flowx://` installer helper (nice-to-have after CLI works)
