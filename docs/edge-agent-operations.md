# FlowX Edge Agent 运维说明

当前 `flowx-local` 是 FlowX Edge Agent 的本地承载包，负责浏览器到本地工具的安全交接、设备身份、
设计上下文落盘、完成报告回传和离线 Outbox。

部署到远程服务器时，API 进程必须配置本机 Agent 可达的公网地址，例如：

```bash
PUBLIC_API_BASE_URL=https://flowx.example.com/api
```

未设置时，本地启动 / OpenDesign redeem 会回退到 `http://127.0.0.1:$PORT`，仅适合本机联调。
Web 在 `VITE_API_BASE_URL=/api` 时会把相对路径解析为当前页面的 `origin + /api` 再交给本机 `flowx-local`。

## 常用命令

### 终端用户

```bash
npm install -g @flowx-ai/local
flowx-local serve
flowx-local status
flowx-local sync
flowx-local mcp
flowx-local design-submit <executionSessionId>
```

不想全局安装时，可用 `npx @flowx-ai/local serve` 启动本地 Agent。

### 仓库贡献者

在 FlowX monorepo 内开发时：

```bash
pnpm --filter @flowx-ai/local build
pnpm flowx-local serve
pnpm flowx-local status
pnpm flowx-local sync
pnpm flowx-local design-submit <executionSessionId>
```

## 本地目录

| 路径 | 用途 | 是否可删除 |
| --- | --- | --- |
| `~/.flowx/local.json` | 端口、设备身份、API 地址和工具启动配置 | 不建议；删除后会生成新身份 |
| `~/.flowx/design-sessions/` | OpenDesign 上下文、结果与会话凭据 | 会话完成且无需追溯后可清理 |
| `~/.flowx/outbox/` | 等待重放的同步事件 | 不要手动删除未完成项 |

这些目录不得提交到项目仓库。`session.json` 含短期 token，权限应保持 `0600`。

## 健康检查

```bash
curl http://127.0.0.1:3920/health
```

响应包含 `deviceId`、`installationId`、`protocolVersion` 和 `outboxPending`，不包含密钥。

## 本地开发执行

本地开发执行不创建或读取 `~/.flowx/active-execution.json`。`claim-local`、Web 本地启动和
Edge Handoff 都会在可用时返回 `executionSessionId`；开发 Agent 必须使用该 ID 回传进度、证据和完成结果。

完成的首选入口是 `POST /execution-sessions/:id/complete`，其请求体为包含仓库、提交、测试结果和
`idempotencyKey` 的本地完成报告。服务端会执行远程分支校验、登记 Artifact/Evidence，并将工作流推进到
Review。`POST /workflow-runs/:id/execution/complete-local` 仍保留给旧 Web、MCP 或 Extension 使用；
它只会解析当前 LOCAL 会话后委托给同一完成命令，不应作为新客户端的默认入口。

开发 Agent 通过 MCP 使用以下工具：

1. `flowx_report_progress` 追加 `execution.progressed` 进度事件；
2. `flowx_report_evidence` 登记 Git、测试或其他执行证据；
3. `flowx_report_completion` 携带 `executionSessionId` 完成本地执行。

`flowx_report_completion` 缺少 `executionSessionId` 时会明确提示并走兼容 `complete-local` 路径；应从任务
提示、handoff 或本地启动返回值补齐该 ID，而不是依赖本地活跃执行文件。

## 故障排查

### FlowX 提示未检测到 flowx-local

确认 `serve` 进程正在运行，且 `~/.flowx/local.json` 中的 `port` 与页面拿到的 loopback port 一致。
本地服务只监听 `127.0.0.1`，不应暴露到局域网或公网。

### 点击 OpenDesign 后只打开 App、没有挂载目录

这是预期行为：项目目录由设计师在 Open Design 内自行选择。FlowX 通过
`~/.flowx/active-design.json` 记录活跃会话，由 Cursor / Codex 中的 `flowx-local mcp` 拉取上下文并回传结果：

1. `flowx_get_active_design_session`
2. `flowx_get_design_handoff`
3. `flowx_submit_design`

也可把可执行文件绝对路径写入 `~/.flowx/local.json` 的 `openDesignCommand`。
不要把 macOS 系统的 `/usr/bin/od` 误认为 OpenDesign CLI。

### 回传进入 Outbox

先检查 API 是否可达，再执行：

```bash
flowx-local status
flowx-local sync
```

Outbox 使用指数退避，重复发送由服务端 `idempotencyKey` 去重。如果短期 token 已过期，回到
FlowX 工作流详情重新打开本地设计，刷新会话凭据后再同步。

### 开发 MCP 或 Cursor Extension 离线

当前可靠 Outbox 已用于 OpenDesign 和 brainstorm 回传；开发阶段的 MCP 进度、证据和完成报告仍要求 API
可达。Cursor Extension 的完成草稿接入 `flowx-local` Outbox 是待办项：离线时不要假定报告已被服务器接收，
恢复连接后重新以相同 `idempotencyKey` 提交。

### result.json 校验失败

确认 `idempotencyKey` 非空，并且 `output.design`、`output.demo`、
`output.designArtifact.html` 都存在。HTML 必须是完整、自包含文档。

## 安全边界

- 浏览器只把一次性、五分钟有效且仅可兑换一次的 ticket 发到本机 Agent。
- Agent 兑换 ticket 后得到短期 token；FlowX Web 的长期登录态不会落盘到设计目录。
- Outbox 不复制 token，只记录会话凭据引用。
- 本地 HTTP 服务仅绑定 loopback；部署脚本不应改成 `0.0.0.0`。
- 设备级长期凭据与自动刷新尚未实现，属于下一阶段工作。
