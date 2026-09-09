# flowx-local WorkBuddy 本地 IDE 支持 — Design Spec

> **Status:** Approved for planning  

> **Date:** 2026-09-09  
> **Depends on:** [Web Local IDE Launch](./2026-07-16-web-local-ide-launch-design.md)、现有 `packages/flowx-local` Cursor / Codex adapter  
> **Goal of v1:** 把腾讯 WorkBuddy 桌面端做成第三本地 IDE，覆盖 setup、项目级 MCP/Skill、Web「本地启动」。

## Problem

`flowx-local` 只把 Cursor 和 Codex 当成可启动 IDE。团队已在使用腾讯 WorkBuddy 桌面端（配置目录 `~/.workbuddy` / 项目 `.workbuddy`），但 `setup`、项目落盘和 Web「本地启动」都无法选它。CodeBuddy CLI（`codebuddy`）不在本轮范围。

## Goals

| 目标 | 衡量 |
|------|------|
| 第三 IDE | `ide` / `defaultIde` / setup target 增加 `workbuddy`，与 `cursor` / `codex` 同级 |
| 默认安装 | `flowx-local setup` 无参数时默认 `cursor,codex,od,workbuddy` |
| 用户级配置 | 写入 `~/.workbuddy/mcp.json` 与 `~/.workbuddy/skills/`，合并已有 MCP server，不覆盖无关内容 |
| 项目级配置 | `ide=workbuddy` 启动时写入 `<repo>/.workbuddy/mcp.json` 和 `.workbuddy/skills/flowx-local-execution/` |
| Web 入口 | 工作流详情「本地启动」增加 WorkBuddy |
| 桌面打开 | macOS `open -a WorkBuddy <gitRoot>`；Windows 解析 `WorkBuddy.exe` 后打开仓库路径 |

## Non-goals

- 组织级 AI 凭据、云端 `aiProvider`、`sourceTool` 增加 `workbuddy`
- 接入 CodeBuddy CLI（`codebuddy`）或把 WorkBuddy 与 CodeBuddy 混成一个 target
- Linux 桌面启动猜测（不 spawn，返回 `opened: false`）
- Chat/Agent 预填；提示词只写 `.flowx/tasks/<workflowRunId>.md`，macOS 再复制剪贴板
- 抽取通用 mcp.json 写入层（本轮按 Cursor 同构 JSON 各写一份）
- 改变 Cursor / Codex 现有 `.cursor` / `.agents` 落盘行为

## Chosen approach

**第三 IDE，沿用现有 Cursor 启动链路**（不做成 OpenDesign 式独立 surface，也不做成云端执行器）。

```text
Web「本地启动」选 WorkBuddy
  → flowx-local /launch { ide: "workbuddy" }
  → WorkBuddyAdapter
  → 写项目 .workbuddy/mcp.json + Skill + 提示词文件
  → 打开 WorkBuddy 桌面端
```

用户级配置仍走 `setup`。MCP 形状与 Cursor 相同：`mcpServers.flowx` 命令为 `flowx-local mcp`。

## Architecture

- 新增 `WorkBuddyAdapter`，复用 `launchIde`，`name = 'workbuddy'`。
- `Ide` / `DefaultIde` / `SetupTarget` / `UserMcpTarget` 增加 `'workbuddy'`。
- `openIde` 按平台打开桌面端，不调用 `codebuddy`。
- `ensureProject` 增加可选 `ide`：仅 `workbuddy` 时写 `.workbuddy/*`；`cursor` / `codex` / 缺省保持现有 `.cursor` + `.agents`。
- Web `flowx-local-bridge` 与启动对话框扩展 `ide` 联合类型；不改凭据页。

## Components

| 单元 | 职责 |
|------|------|
| `WorkBuddyAdapter` | 把 `ide: 'workbuddy'` 交给 `launchIde` |
| `openIde` | 按平台打开桌面端；失败返回 `opened: false` |
| `upsertUserMcp` | 合并 `~/.workbuddy/mcp.json`，非法 JSON 不覆盖 |
| `runSetup` / `parseSetupTargets` | 默认 target 含 `workbuddy`；Skill 写到 `~/.workbuddy/skills/` |
| `ensureProject` | `ide=workbuddy` 写项目级 `.workbuddy` MCP + 执行 Skill |
| `/launch` | 接受 `ide: "workbuddy"` |
| Web 启动对话框 / bridge | 第三选项与 toast 文案 |

## Data flow

1. 用户执行 `flowx-local setup`（默含 workbuddy）→ 用户级 MCP + 产品/需求 Skill。
2. Web 对执行中工作流点「本地启动」→ 选 WorkBuddy → 现有 ticket / claim-local → `POST /launch`。
3. daemon redeem ticket → 解析仓库路径 → `WorkBuddyAdapter.launch`。
4. `ensureProject` 合并项目 `.workbuddy/mcp.json`（短效 `FLOWX_API_BASE_URL` / `FLOWX_API_TOKEN`）并补执行 Skill。
5. 写 `.flowx/tasks/<workflowRunId>.md`；macOS 复制剪贴板。
6. 打开 WorkBuddy；Agent 通过 MCP 回传完成。

用户级 MCP 不写长期 token（与 Cursor 相同，剥离 `FLOWX_API_TOKEN` / `FLOWX_API_BASE_URL`）。

## Launch

| 平台 | 行为 |
|------|------|
| macOS | `open -a WorkBuddy <gitRoot>` |
| Windows | 启动 `WorkBuddy.exe <gitRoot>`。查找顺序：`WORKBUDDY_PATH` → `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe` |
| Linux | 不 spawn，返回 `opened: false` |

找不到 exe 或 spawn 失败：项目文件仍写入，返回 `opened: false`。

## Configuration

**用户级（setup）**

- `~/.workbuddy/mcp.json`：Cursor 同构 JSON，合并 `mcpServers.flowx`
- `~/.workbuddy/skills/flowx-product-prd/SKILL.md`
- `~/.workbuddy/skills/flowx-intake-requirement/SKILL.md`

**项目级（仅 `ide=workbuddy` 启动）**

- `<repo>/.workbuddy/mcp.json`：本次短效 API URL / token
- `<repo>/.workbuddy/skills/flowx-local-execution/SKILL.md`（已有则不覆盖）

`defaultIde` 允许 `'workbuddy'`。显式 `flowx-local setup workbuddy` 仍然有效。

## Error handling

- `/launch` 非法 `ide`：400，提示需要 `ticket, ide, apiBaseUrl`。
- 已有 `mcp.json` 非法：抛错，不覆盖原文件。
- 桌面端缺失 / spawn 失败 / Linux：`opened: false`，提示词文件仍在。
- Web toast：打开成功写「已打开 WorkBuddy」；`opened: false` 写「提示词已生成，但未打开 WorkBuddy」。

## Web and docs

- `apps/web/src/lib/flowx-local-bridge.ts`：`ide` 增加 `'workbuddy'`。
- `WorkflowRunDetailPage`：对话框第三按钮；toast / 帮助文案包含 WorkBuddy。
- 不改 AI 凭据页、需求页云端执行器、`aiProvider`。
- 同步：`docs/local-agent-guide.md`、`docs/web-local-ide-launch.md`、`docs/user-manual.md` 及 `apps/web/public` 对应镜像。

## Testing

- `open-ide`：darwin 调用 `open -a WorkBuddy <path>`；win32 解析 exe；linux 不 spawn。
- `user-mcp` / `setup`：默认 target 含 `workbuddy`；合并用户级 mcp.json；非法 JSON 不覆盖。
- `ensure-project`：`ide=workbuddy` 只写 `.workbuddy/*`；Cursor / Codex 路径不变。
- adapter / `/launch`：接受 `workbuddy`。
- Web：bridge 契约 + 启动对话框第三选项。
- 交付：`pnpm --filter @flowx-ai/local test`、`pnpm --filter flowx-web test`；手册 `cmp`。

## Out of scope recap

WorkBuddy 不是云端模型执行器。本轮只解决本机打开与 MCP/Skill 落盘。后续若要 CodeBuddy CLI 或凭据，另开变更。
