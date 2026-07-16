# Web Local IDE Launch

Preferred Web entry for local execution: start from FlowX Web, open Cursor or Codex on your machine via the `flowx-local` bridge, then finish with MCP or the Web UI.

```text
FlowX Web「本地启动」 → flowx-local (loopback) → Cursor / Codex (+ Skill + MCP)
```

This path reuses the same `claim-local` / handoff / `complete-local` contract as [local-execution-handoff.md](./local-execution-handoff.md). The Cursor extension remains an optional fallback; see [cursor-plugin-local-chat.md](./cursor-plugin-local-chat.md).

## Prerequisites

Build the MCP server and local bridge (once, or after code changes):

```bash
pnpm --filter flowx-mcp build
pnpm --filter flowx-local build
```

Keep the FlowX API and Web apps running as usual (`pnpm dev` or equivalent).

## Start the local daemon

`flowx-local` must be listening on loopback before Web can launch an IDE:

```bash
pnpm --filter flowx-local exec node dist/index.js serve
```

From the repo root you can also use:

```bash
pnpm flowx-local serve
```

Web probes the daemon’s `/health` endpoint. If it is not reachable, the UI shows start instructions instead of claiming success.

## Optional: map a repository URL to a local path

If you already know where a clone lives, register it so launch skips the directory picker:

```bash
pnpm --filter flowx-local exec node dist/index.js map <repoUrl> <path>
```

Example:

```bash
pnpm flowx-local map https://github.com/org/repo.git /Users/you/src/repo
```

Unmapped repos prompt for a local directory on first launch (when a picker is available); the choice is remembered in `~/.flowx/local.json`.

## Launch from Web

1. Open a workflow run that is ready for execution (`EXECUTION_PENDING`, or already in local execution).
2. On the Workflow detail page, click **本地启动**.
3. Choose **Cursor** or **Codex**.

Web claims local execution when needed, issues a short-lived launch ticket, and calls `flowx-local` `/launch`. The daemon resolves repo paths, ensures FlowX Skill + MCP config in the project, opens the IDE, and delivers the task prompt (Chat/Agent prefill when possible; otherwise a file under `.flowx/tasks/` plus clipboard).

## Environment: `FLOWX_MCP_ENTRY`

On launch, `flowx-local` tries to resolve `packages/flowx-mcp/dist/index.js` relative to the monorepo. If that auto-resolve fails (unusual layout or install), set an absolute path:

```bash
export FLOWX_MCP_ENTRY=/absolute/path/to/FlowX/packages/flowx-mcp/dist/index.js
```

Then restart the daemon.

## Completing local work

After implementing on the working branch:

1. Prefer MCP: Agent calls `flowx_report_completion` (often after `flowx_collect_git_report`).
2. Or use Web: **完成本地执行** on the workflow detail page (same `complete-local` API).

Cancel with **取消本地执行** if you need to return to `EXECUTION_PENDING`.

## Related docs

- [local-execution-handoff.md](./local-execution-handoff.md) — branch naming, handoff fields, and `complete-local` contract
- [cursor-plugin-local-chat.md](./cursor-plugin-local-chat.md) — Cursor extension + MCP task picker (fallback when not using Web「本地启动」)
