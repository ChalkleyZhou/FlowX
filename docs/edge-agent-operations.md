# FlowX Edge Agent 运维说明

当前 `flowx-local` 是 FlowX Edge Agent 的本地承载包，负责浏览器到本地工具的安全交接、设备身份、
设计上下文落盘、完成报告回传和离线 Outbox。

## 常用命令

### 终端用户

```bash
npm install -g @flowx-ai/local
flowx-local serve
flowx-local status
flowx-local sync
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

## 故障排查

### FlowX 提示未检测到 flowx-local

确认 `serve` 进程正在运行，且 `~/.flowx/local.json` 中的 `port` 与页面拿到的 loopback port 一致。
本地服务只监听 `127.0.0.1`，不应暴露到局域网或公网。

### 点击 OpenDesign 后只打开 App、没有挂载目录

这是预期行为：项目目录由设计师在 Open Design 内自行选择。FlowX 通过
`~/.flowx/active-design.json` 记录活跃会话，由 `flowx-mcp` 拉取上下文并回传结果：

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

### result.json 校验失败

确认 `idempotencyKey` 非空，并且 `output.design`、`output.demo`、
`output.designArtifact.html` 都存在。HTML 必须是完整、自包含文档。

## 安全边界

- 浏览器只把一次性、五分钟有效且仅可兑换一次的 ticket 发到本机 Agent。
- Agent 兑换 ticket 后得到短期 token；FlowX Web 的长期登录态不会落盘到设计目录。
- Outbox 不复制 token，只记录会话凭据引用。
- 本地 HTTP 服务仅绑定 loopback；部署脚本不应改成 `0.0.0.0`。
- 设备级长期凭据与自动刷新尚未实现，属于下一阶段工作。
