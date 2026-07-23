# Web Local IDE Launch

Preferred Web entry for local execution: start from FlowX Web, open Cursor or Codex on your machine via the `flowx-local` bridge, then finish with MCP or the Web UI.

```text
FlowX Web「本地启动」 → flowx-local (loopback) → Cursor / Codex (+ Skill + MCP)
```

This path reuses the same `claim-local` / handoff contract as [local-execution-handoff.md](./local-execution-handoff.md). Prefer completing through the session API returned as `executionSessionId`; `complete-local` remains a compatibility wrapper. The Cursor extension remains an optional fallback; see [cursor-plugin-local-chat.md](./cursor-plugin-local-chat.md).

## Prerequisites

终端用户只需要安装并启动 `@flowx-ai/local`；`flowx-local` 自带 MCP command，不需要单独安装或构建 `flowx-mcp`：

```bash
npm install -g @flowx-ai/local --registry https://registry.npmjs.org
flowx-local serve
```

Keep the FlowX API and Web apps running as usual (`pnpm dev` or equivalent).

## Start the local daemon

`flowx-local` must be listening on loopback before Web can launch an IDE.

**End users:**

```bash
npm install -g @flowx-ai/local
flowx-local serve
```

Or without a global install: `npx @flowx-ai/local serve`.

**Contributors** (FlowX monorepo):

```bash
pnpm --filter @flowx-ai/local build
pnpm flowx-local serve
```

Web probes the daemon’s `/health` endpoint. If it is not reachable, the UI shows start instructions instead of claiming success.

## Optional: map a repository URL to a local path

If you already know where a clone lives, register it so launch skips the directory picker:

```bash
flowx-local map <repoUrl> <path>
```

Example:

```bash
flowx-local map https://github.com/org/repo.git /Users/you/src/repo
```

Contributors can also run `pnpm flowx-local map <repoUrl> <path>` from the monorepo root.

Unmapped repos prompt for a local directory on first launch (when a picker is available); the choice is remembered in `~/.flowx/local.json`.

## Launch from Web

1. Open a workflow run that is ready for execution (`EXECUTION_PENDING`, or already in local execution).
2. On the Workflow detail page, click **本地启动**.
3. Choose **Cursor** or **Codex**.

Web claims local execution when needed, issues a short-lived launch ticket, and calls `flowx-local` `/launch`. The daemon resolves repo paths, ensures FlowX Skill + MCP config in the project, opens the IDE, and delivers the task prompt (Chat/Agent prefill when possible; otherwise a file under `.flowx/tasks/` plus clipboard).

## MCP configuration

Cursor / Codex should register the local agent as the MCP command:

```json
{
  "mcpServers": {
    "flowx": {
      "command": "flowx-local",
      "args": ["mcp"]
    }
  }
}
```

When launching from FlowX Web, `flowx-local` writes or merges this project-level `.cursor/mcp.json` automatically and adds the deployment API URL plus short-lived token for that launch. Cursor starts `flowx-local mcp` on demand; the MCP process reads the active short-lived session from the local agent. For manual configuration, keep the minimal config above and do not hard-code `127.0.0.1`.

## Completing local work

After implementing on the working branch:

1. Prefer MCP: Agent calls `flowx_report_completion` with the launch/handoff `executionSessionId` (often after `flowx_collect_git_report`). This uses the session completion API.
2. Or use Web: **完成本地执行** on the workflow detail page. This remains compatible through `complete-local`.

Cancel with **取消本地执行** if you need to return to `EXECUTION_PENDING`.

## Related docs

- [local-execution-handoff.md](./local-execution-handoff.md) — branch naming, handoff fields, and `complete-local` contract
- [cursor-plugin-local-chat.md](./cursor-plugin-local-chat.md) — Cursor extension + MCP task picker (fallback when not using Web「本地启动」)
