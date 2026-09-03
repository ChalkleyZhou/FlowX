# FlowX 本地 Agent 使用指南

在本机把 FlowX 接到 Cursor / Codex。Skill 是流程说明，MCP 是实际调用的工具，需要一起装；安装脚本会处理。

## 安装

在 FlowX 网页（与你日常使用的同一站点）执行：

```bash
curl -fsSL https://<当前站点>/install | bash
flowx-local login
```

脚本会检查 Node.js 20+（没有则打开 https://nodejs.org/ 自行安装后重跑）、安装 `@flowx-ai/local`、注册本机后台服务，并在检测到 Cursor / Codex 时询问是否写入 Skill 和 MCP。`login` 只粘贴设置页生成的 `fxpat_…` token。

平台内也可打开侧栏「本地 Agent」复制当前站点的 curl。

## 这是什么

`flowx-local`（npm 包名 `@flowx-ai/local`）是 FlowX 的本机 Edge Agent：

- 只监听本机 loopback（默认 `http://127.0.0.1:3920`）
- 用 Personal API Token（`fxpat_…`）写入 `~/.flowx/credentials.json`，供 MCP 长期鉴权
- 接收 Web 下发的一次性启动票据，兑换短期凭据（可选兜底）
- 打开本地 IDE 或 OpenDesign，并写入执行/设计上下文
- 作为 Cursor / Codex 的 MCP command，提供任务列表、binding、handoff / 完成回报和 OpenDesign 工具
- 在网络不稳时把完成报告放入本地 Outbox，稍后重试回传

不需要把 FlowX 仓库克隆到本机才能使用。安装脚本会注册后台服务，登录后自动启动。

Token 在「设置」→ [API Token](/settings/api-tokens) 生成（明文前缀 `fxpat_`，仅显示一次）。凭据保存在 `~/.flowx/credentials.json`（`0600`）。也可设置环境变量 `FLOWX_API_TOKEN` + `FLOWX_API_BASE_URL`。登出本机：`flowx-local logout`（如需作废服务端 token，请到设置页撤销）。校验失败（含连错地址）时**不会**写入凭据。

MCP 鉴权顺序：

1. 环境变量 `FLOWX_API_TOKEN`（仅当值为 `fxpat_…` 长期 token）
2. `~/.flowx/credentials.json`（`flowx-local login`）
3. 环境变量里的短期 token（兼容 Web「本地启动」写入的项目 `.cursor/mcp.json`）
4. 未过期的 `active-design.json` 短期 token

有长期 credentials 时，不会被 Web 注入的过期短期 `FLOWX_API_TOKEN` 盖住。

## 在 FlowX 里怎么用

### 本地发起需求（推荐主路径）

平台需求页主按钮是「创建需求」。已安装本地 Agent 时，**新建需求并启动工作流**也可以在 Cursor / Codex 用本地 AI 完成。

前置：已完成安装与 `flowx-local login`（含 `flowx-intake-requirement` Skill）。

只有明确说“在 FlowX 新建 / 登记 / 发起需求”时才进入该流程。普通的功能实现、代码修改、问题修复或需求讨论继续在当前项目处理，不会创建 FlowX 数据。若是否要登记到 FlowX 不明确，Agent 必须先询问“直接在当前项目处理，还是登记到 FlowX？”，得到明确答复前不调用 FlowX 工具。

1. 在 IDE 中说明要「新建 / 发起 FlowX 需求」（触发 `flowx-intake-requirement` Skill）
2. Agent 调用 `flowx_list_projects`，由你选定项目（不要用本地仓库路径猜测）
3. **确认发布版本（硬门禁）**：Agent 必须展示该项目当前版本（没有则明确说「当前无版本」）以及版本清单，等你选择后再创建。有当前版本时选 **用当前版本** 或 **新建版本**；无当前版本时选 **新建版本** 或 **本需求暂不挂版本**。新建时 Agent 调用 `flowx_create_project_version`（`setAsCurrent: true`）
4. 收齐标题、描述；验收标准若未给，可用短占位（可日后在 Web 改）
5. `flowx_create_requirement` 创建需求，**必须传入**确认后的 `versionId`（具体 id 或 `null`），禁止省略该字段靠服务端默认
6. Agent 展示启动摘要（需求、仓库范围、执行器、是否进入构思）；**你确认后**再以 `userConfirmedStart: true` 调用 `flowx_start_workflow`
7. 若选择进入构思：`flowx_bind_workflow` → 按 `flowx-product-prd` 继续；若仅启动，可稍后在 Web 查看或再 `flowx_list_tasks`

相关 MCP 工具：

| 工具 | 作用 |
| --- | --- |
| `flowx_list_projects` | 列出可见工作区/项目（含 `currentVersion` 与 `versions`） |
| `flowx_create_project_version` | 新建发布版本；intake 选「新建版本」时传 `setAsCurrent: true` |
| `flowx_create_requirement` | 创建需求；必须带确认后的 `versionId`（id 或 `null`） |
| `flowx_start_workflow` | 启动工作流；必须先确认，且 `userConfirmedStart=true` |

已创建但启动失败时，需求会保留，可再次确认后重试启动，或回 Web 启动。

### 工作流「本地启动」

1. 打开一条 **Spec & Plan 已确认**、进入开发执行阶段的工作流
2. 确认本机 Agent 在运行（安装后的后台服务；可用 `flowx-local status`）
3. 点击「本地启动」，选择 Cursor 或 Codex
4. Agent 会匹配本地仓库路径（必要时提示映射）、写入 Skill/MCP，并打开 IDE。写入的 MCP command 是 `flowx-local mcp`。

开发完成后，可用 IDE 内 MCP 回写完成报告，或在 Web 上使用「完成本地执行」。

### OpenDesign 本地构思与设计（推荐金路径）

1. 已完成安装与 `flowx-local login`（安装脚本会写入 `flowx-intake-requirement`、`flowx-product-prd` 以及用户级 MCP）
2. Agent 调用 `flowx_list_tasks` → 与你确认一条工作流 → `flowx_bind_workflow`（写入 `~/.flowx/current-workflow.json`）
3. **产品构思**：`flowx_get_brainstorm_handoff` → 头脑风暴澄清 → 写 `prd.md` → 确认后 `flowx_submit_brainstorm`（响应含 `next.stage=design`，binding 切到 design）
4. **同一会话设计**：立刻 `flowx_get_design_handoff`（服务端惰性创建 design 会话）→ 在 Open Design 中完成 `design.md` 与 HTML 原型 → 向用户确认 `design.md` 全文后 `flowx_submit_design({ markdown, output })`
   - `markdown` 为完整 `design.md` 正文；多端时在 `design/` 下按端建目录（推荐 `Web端` / `移动端` / `管理后台`，每端可多页 HTML），回传 `output.surfaces`。
5. 平台进入 `待确认设计方案`：工作流详情展示 **设计文档（Markdown）** 与 **HTML 预览** 两个模块（按实际上传的端展示 Tab）；旧 run 无 `markdown` 时显示「尚未提交设计文档」

产品构思期望流程（读者：产品经理 / 设计师；**不写** API、框架、数据库等实现细节）：多轮头脑风暴澄清产品需求 → 写出精简 `prd.md` → 在 IDE 里向用户展示全文并确认 → 再通过 MCP `flowx_submit_brainstorm` 回传。平台只展示最终产品需求（PRD）Markdown，并进入设计阶段。旧版 `spec.md` 文件名仍兼容，但新流程以 `prd.md` 为准。提交成功后可在**同一 OpenDesign 会话**继续拉设计 handoff，无需回 Web 再点一次「打开本地 OpenDesign」。

设计确认或跳过后，工作流进入 **Spec & Plan** 阶段。该阶段在 Web 端生成与确认实现边界（spec）与实现路径（plan），**不可跳过**；当前本地 MCP 不提供 Spec & Plan handoff。确认 Spec & Plan 后，工作流进入 **待执行开发**，可按上一节进行本地启动。

若已进入设计阶段仍要改产品需求：在工作流详情切到「产品构思」，点「重新构思」，确认后再用 list/bind 或 handoff 重做构思。

若本机仍保留旧版 `flowx-brainstorm-spec`，或 `flowx-intake-requirement` 仍会把普通开发请求直接创建为 FlowX 需求，请执行 `flowx-local update`（默认更新已安装 Skill）或 `flowx-local setup --force` 切换到新 Skill。

**可选兜底**：未配置长期 token 时，可在工作流详情点击 `打开本地构思` / `打开本地 OpenDesign`，由 Web 写入短期 `active-design` 会话。该路径仍可用，但构思完成后通常还需再点一次「打开本地 OpenDesign」；金路径下应避免依赖第二次点击。点击「打开本地构思」或「打开本地 OpenDesign」时，平台会先弹出两步操作引导（选择项目目录、输入「获取FlowX任务」），确认后再打开应用。

安装脚本已写入用户级 MCP。手工配置时可写成：

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

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `flowx-local setup [targets] [--force]` | 安装用户级 Skill：`flowx-intake-requirement` + `flowx-product-prd`（默认 cursor,codex,od），并写入用户级 MCP、后台服务 |
| `flowx-local update [targets] [--no-force]` | 升级本机包并刷新对应 Skill（默认覆盖；通过 --no-force 保留自定义） |
| `flowx-local login [--token TOKEN]` | 写入 Personal API Token；地址已由安装脚本写入，一般不必再填 `--api-base-url` |
| `flowx-local logout` | 清除本机凭据 |
| `flowx-local version`（或 `-v` / `--version`） | 显示本机版本，并与 npm latest 对比是否可升级 |
| `flowx-local status` | 查看设备身份、后台服务与待同步数量 |
| `flowx-local sync` | 重试 Outbox 中未回传的事件 |
| `flowx-local map <repoUrl> <path>` | 手动把远程仓库 URL 映射到本地目录 |

## 排障

### 页面提示「未检测到本机 flowx-local」

安装脚本会注册后台服务。先执行 `flowx-local status`，或 `curl http://127.0.0.1:3920/health`。不要把服务绑到局域网地址；只应监听 `127.0.0.1`。贡献者或排障时可在终端运行 `flowx-local serve` 并保持窗口不关。

### 安装后找不到 `flowx-local` 命令

确认全局 npm bin 目录在 `PATH` 中。公司内网源若没有该包，安装时加上 `--registry https://registry.npmjs.org`。禁止 `curl | bash` 的环境可用 `npm install -g @flowx-ai/local --registry https://registry.npmjs.org`，再执行 `flowx-local setup --api-base-url https://你的-flowx-域名/api`。

### `login` 询问 API 地址，或 MCP 连错环境

curl 安装会把当前站点的 API 写入 `~/.flowx/local.json`。若地址未确认、仍是历史默认 `http://127.0.0.1:3000`，或校验失败，`login` **不会**写入凭据。可显式指定：

```bash
flowx-local login --api-base-url https://你的-flowx-域名/api --token fxpat_…
```

也可用 `cat ~/.flowx/credentials.json` 核对 `apiBaseUrl`。本机开发请先启动 FlowX API（`pnpm dev:api`），再 `login`。

### 设计或完成结果进了 Outbox

通常是当时 FlowX API 不可达。先确认网络与 API，再执行 `flowx-local status` 与 `flowx-local sync`。若短期会话凭据已过期，优先改用 Personal API Token（设置页生成后 `flowx-local login`）。

### 命令行为与文档不一致（例如没有 `login`）

```bash
flowx-local version
npm list -g @flowx-ai/local
```

若落后于 npm latest：`npm install -g @flowx-ai/local@latest --registry https://registry.npmjs.org`，或重新跑当前站点的 `/install` 脚本。

### MCP 提示会话 token 已过期

常见原因：`credentials.json` 里 `apiBaseUrl` 不对；本机还有过期的 `~/.flowx/active-design.json`；某项目 `.cursor/mcp.json` 里残留 Web 启动写入的短期 `FLOWX_API_TOKEN`。用正确 `--api-base-url` 重新 `login`，可选 `rm -f ~/.flowx/active-design.json`，然后**重启** Cursor / OpenDesign 里的 FlowX MCP。

## 更多帮助

- 平台总览请看侧栏「使用手册」
- 运维目录与安全边界见仓库 `docs/edge-agent-operations.md`
