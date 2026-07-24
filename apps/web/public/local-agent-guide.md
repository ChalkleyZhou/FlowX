# FlowX 本地 Agent 使用指南

本文档面向需要在本机安装并使用 `@flowx-ai/local` 的同学。本地 Agent 在你的电脑上运行，把 FlowX Web 与 Cursor / Codex / OpenDesign 安全地接在一起。

## 1. 这是什么

`flowx-local`（npm 包名 `@flowx-ai/local`）是 FlowX 的本机 Edge Agent：

- 只监听本机 loopback（默认 `http://127.0.0.1:3920`）
- 用 Personal API Token（`fxpat_…`）写入 `~/.flowx/credentials.json`，供 MCP 长期鉴权
- 接收 Web 下发的一次性启动票据，兑换短期凭据（可选兜底）
- 打开本地 IDE 或 OpenDesign，并写入执行/设计上下文
- 作为 Cursor / Codex 的 MCP command，提供任务列表、binding、handoff / 完成回报和 OpenDesign 工具
- 在网络不稳时把完成报告放入本地 Outbox，稍后重试回传

不需要把 FlowX 仓库克隆到本机才能使用。

## 2. 安装

使用公共 npm 安装（若本机默认公司源，请显式指定 registry）：

```bash
npm install -g @flowx-ai/local --registry https://registry.npmjs.org
```

安装完成后，终端应能直接运行 `flowx-local`。

不想全局安装时，可用：

```bash
npx @flowx-ai/local@latest serve
```

## 3. 启动

```bash
flowx-local serve
```

保持该终端窗口运行。可用下面命令确认健康状态：

```bash
flowx-local status
```

或：

```bash
curl http://127.0.0.1:3920/health
```

首次运行会在 `~/.flowx/local.json` 写入设备身份与端口等配置。

## 3.1 安装构思 Skill（首次建议）

在第一次做「产品构思」前，把用户级 Skill 装到本机 Cursor / Codex / OpenDesign 可发现的目录：

```bash
flowx-local setup                 # 默认 cursor,codex,od
flowx-local setup cursor
flowx-local setup cursor,codex,od --force
```

这会写入 `flowx-brainstorm-spec` Skill（不覆盖已有文件，除非加 `--force`）。`serve` **不会**静默安装 Skill。

产品构思期望流程：多轮澄清 → 写出 `spec.md` → 在 IDE 里确认 → 再通过 MCP `flowx_submit_brainstorm` 回传；平台只展示最终规格 Markdown，并进入设计阶段。提交成功后可在**同一 OpenDesign 会话**继续拉设计 handoff，无需回 Web 再点一次「打开本地 OpenDesign」。

## 3.2 配置 Personal API Token（推荐）

OpenDesign 推荐用长期 Personal API Token，而不是每次依赖 Web 短期会话：

1. 在 FlowX Web「设置」→ [API Token](/settings/api-tokens)（`/settings/api-tokens`）生成 token（明文前缀 `fxpat_`，仅显示一次）
2. 写入本机。**`login` 默认校验并保存的 API 地址是 `http://127.0.0.1:3000`**（来自 `~/.flowx/local.json` 的 `apiBaseUrl`，未配置时用该默认值）。

**连本机开发 API**（需先启动 `pnpm dev` / `pnpm dev:api`）：

```bash
flowx-local login --token fxpat_…
# 或交互粘贴：flowx-local login
```

**连远程 / 部署环境的 FlowX**（日常使用更常见）时，必须带上可访问的 API 根地址：

```bash
flowx-local login --api-base-url https://你的-flowx-域名 --token fxpat_…
```

也可先把 `~/.flowx/local.json` 里的 `apiBaseUrl` 改成部署地址，再执行不带 `--api-base-url` 的 `login`。

若出现 `Warning: could not reach …/auth/session/me … Saving token anyway.`，表示当时校验地址不可达（常见原因：本机 3000 未启动，或未指定远程 `--api-base-url`）。token **仍会写入** `credentials.json`，但 MCP 之后会按这份错误的 `apiBaseUrl` 去请求，需要重新 `login` 并指定正确地址。

凭据保存在 `~/.flowx/credentials.json`（`0600`）。也可设置环境变量 `FLOWX_API_TOKEN` + `FLOWX_API_BASE_URL`。登出本机：`flowx-local logout`（如需作废服务端 token，请到设置页撤销）。

MCP 鉴权顺序：

1. 环境变量 `FLOWX_API_TOKEN`（仅当值为 `fxpat_…` 长期 token）
2. `~/.flowx/credentials.json`（`flowx-local login`）
3. 环境变量里的短期 token（兼容 Web「本地启动」写入的项目 `.cursor/mcp.json`）
4. 未过期的 `active-design.json` 短期 token

有长期 credentials 时，不会被 Web 注入的过期短期 `FLOWX_API_TOKEN` 盖住。

## 4. 在 FlowX 里怎么用

### 4.1 工作流「本地启动」

1. 打开一条进入开发执行阶段的工作流
2. 确认本机已运行 `flowx-local serve`
3. 点击「本地启动」，选择 Cursor 或 Codex
4. Agent 会匹配本地仓库路径（必要时提示映射）、写入 Skill/MCP，并打开 IDE。写入的 MCP command 是 `flowx-local mcp`。

开发完成后，可用 IDE 内 MCP 回写完成报告，或在 Web 上使用「完成本地执行」。

### 4.2 OpenDesign 本地构思与设计（推荐金路径）

1. 已执行 `flowx-local setup`，并完成上一节的 Personal API Token / `login`
2. 在 Cursor / Codex 配置 `flowx-local mcp`
3. Agent 调用 `flowx_list_tasks` → 与你确认一条工作流 → `flowx_bind_workflow`（写入 `~/.flowx/current-workflow.json`）
4. **产品构思**：`flowx_get_brainstorm_handoff` → 澄清 → `spec.md` → 确认后 `flowx_submit_brainstorm`（响应含 `next.stage=design`，binding 切到 design）
5. **同一会话设计**：立刻 `flowx_get_design_handoff`（服务端惰性创建 design 会话）→ 在 Open Design 中完成设计 → `flowx_submit_design`
6. 平台进入 `待确认设计方案`

若已进入设计阶段仍要改规格：在工作流详情切到「产品构思」，点「重新构思」，确认后再用 list/bind 或 handoff 重做构思。

**可选兜底**：未配置长期 token 时，可在工作流详情点击 `打开本地构思` / `打开本地 OpenDesign`，由 Web 写入短期 `active-design` 会话。该路径仍可用，但构思完成后通常还需再点一次「打开本地 OpenDesign」；金路径下应避免依赖第二次点击。

Cursor 的 MCP 配置可以写成：

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

普通用户不需要构建 `flowx-mcp`。配置 PAT 后，MCP 用本机 credentials + binding 即可跑通构思→设计；Web「本地启动」仍可能写入项目级 `.cursor/mcp.json`（含短期 token），属兼容路径。手工配置时不要把 API 地址写死为 `127.0.0.1`，也不要把 `credentials.json` / token 提交到 Git。

更细的设计阶段说明见仓库文档 `docs/opendesign-design-stage.md`（运维向内容不在本页展开）。

## 5. 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local serve` | 启动本机 Agent |
| `flowx-local setup [targets] [--force]` | 安装用户级 Skill（默认 cursor,codex,od） |
| `flowx-local login [--token TOKEN] [--api-base-url URL]` | 写入 Personal API Token；默认 API 为 `http://127.0.0.1:3000`，远程环境请传 `--api-base-url` |
| `flowx-local logout` | 清除本机凭据 |
| `flowx-local version`（或 `-v` / `--version`） | 显示本机版本，并与 npm latest 对比是否可升级 |
| `flowx-local status` | 查看设备身份与待同步数量 |
| `flowx-local sync` | 重试 Outbox 中未回传的事件 |
| `flowx-local map <repoUrl> <path>` | 手动把远程仓库 URL 映射到本地目录 |

## 6. 常见问题

### Q1：页面提示「未检测到本机 flowx-local」

- 确认终端里 `flowx-local serve` 仍在运行
- 用 `curl http://127.0.0.1:3920/health` 检查是否可达
- 不要把服务绑到局域网地址；只应监听 `127.0.0.1`

### Q2：设计或完成结果进了 Outbox

通常是当时 FlowX API 不可达。先确认网络与 API，再执行：

```bash
flowx-local status
flowx-local sync
```

若短期会话凭据已过期，优先改用 Personal API Token（设置页生成后 `flowx-local login`），或回到 FlowX 重新打开本地设计/启动流程后再同步。

### Q3：安装后找不到 `flowx-local` 命令

- 确认全局 npm bin 目录在 `PATH` 中
- 或改用 `npx @flowx-ai/local serve`
- 公司内网源若没有该包，请加上 `--registry https://registry.npmjs.org`

### Q4：命令行为与文档不一致（例如没有 `login`）

先检查本机版本是否过旧：

```bash
flowx-local version
npm list -g @flowx-ai/local
```

若落后于 npm latest，升级后再试：

```bash
npm install -g @flowx-ai/local@latest --registry https://registry.npmjs.org
```

### Q5：`login` 提示 could not reach http://127.0.0.1:3000/auth/session/me

默认会连本机 `3000` 端口做一次 token 校验。出现该警告时：

- **要用部署环境**：重新执行并带上真实地址，例如  
  `flowx-local login --api-base-url https://你的-flowx-域名/api --token fxpat_…`
- **要用本机 API**：先启动 FlowX API（`pnpm dev:api`），再 `login`
- 警告后仍会保存 token，但若 `apiBaseUrl` 不对，后续 MCP 会请求失败；请用正确地址重新 `login` 覆盖 `credentials.json`

可用 `cat ~/.flowx/credentials.json` 核对其中的 `apiBaseUrl` 是否为你真正访问的 FlowX。

### Q6：MCP 提示会话 token 已过期

常见原因：

1. `~/.flowx/credentials.json` 里 `apiBaseUrl` 仍是 `127.0.0.1:3000`（login 时未带 `--api-base-url`）
2. 本机还有过期的 `~/.flowx/active-design.json`，Agent 读到 `accessTokenExpired: true`
3. 某项目 `.cursor/mcp.json` 里残留 Web 启动写入的短期 `FLOWX_API_TOKEN`

处理：

```bash
flowx-local login --api-base-url https://你的-flowx-域名/api --token fxpat_…
# 可选：清掉过期短期会话指针
rm -f ~/.flowx/active-design.json
```

然后**重启** Cursor / OpenDesign 里的 FlowX MCP 后再试 `flowx_list_tasks`。

## 7. 更多帮助

- 平台总览请看侧栏「使用手册」
- 运维目录与安全边界见仓库 `docs/edge-agent-operations.md`
