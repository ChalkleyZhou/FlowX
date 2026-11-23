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

打开正在使用的 FlowX「本地 Agent」页，复制安装命令后再 `login`。之后：`flowx-local status` / `sync` / `mcp`。

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
| `~/.flowx/updates/<安装路径摘要>/` | 独立版本、活动指针、检查缓存、更新锁与 `update.log` | 运行期间不要手动修改或清理 |

这些目录不得提交到项目仓库。`session.json` 含短期 token，权限应保持 `0600`。

## 调用触发的自动更新

包含此能力的本地包使用稳定的 `dist/index.js` 入口选择已校验版本。CLI、stdio MCP 和 loopback 请求只触发独立后台 worker，五分钟检查缓存和跨进程锁避免重复检查与安装；没有定时版本轮询。更新锁采用每次申请独立记录的 bakery 互斥算法，不按超时抢占存活进程；死 PID 记录不参与竞争。如果遗留记录的 PID 恰被系统复用，检查会保守返回忙碌，需等该 PID 退出后再试。npm CLI 从当前 Node runtime 定位，安装到独立目录并禁用安装脚本，不需要全局写权限或 sudo。npm 下载时仍校验包完整性，随后独立 Node 进程加载实际 CLI 与依赖并核对版本，再原子发布活动指针。安装与校验有超时，失败保留已有安装，源码目录跳过自动安装。

后台服务由稳定父进程承载，新版就绪通过文件事件通知，空闲时直接切换；业务子进程只在当前请求和处理函数全部结束后请求切换；即使调用方断开连接，也必须等待业务操作结束。父进程转发停止信号，正常退出和启动失败不会触发内部无限重启。已有 stdio MCP 长连接保留原进程，IDE 重新连接后才刷新能力。Skill 仅在本机内容仍与旧包模板一致时自动覆盖；其他内容和非 FlowX MCP 配置保留，未安装的 IDE 不会自动增加配置；已有 MCP 入口无需变化时不重写文件，避免触发 IDE 无谓重载。

`flowx-local status` 的 `update` 区分当前 CLI 的 `runningVersion` 与已准备的 `readyVersion`，`service.version` 来自真实 `/health`。更新结果、失败阶段和跳过文件在同一状态中查看，未检查时字段省略。配置 `autoUpdate: false` 或进程环境 `FLOWX_LOCAL_AUTO_UPDATE=0` 关闭检查，已准备版本仍会生效；环境变量修改后重启相应服务/MCP。手动 `update` 不受开关限制，并继续刷新所选集成。

当前已发布 `@flowx-ai/local@0.8.0`；已有 `0.7.2` 必须先手动运行一次 `flowx-local update`。npm/私有安装前缀和 pnpm 的原始入口保持有效，服务端 API 与业务协议不变。更新目录保留旧版本以保护尚在使用它们的进程，目前不自动回收，需在停止所有本地服务与 MCP 后再按运维策略清理。Windows/Linux 的核心逻辑使用 Node API，实机兼容仍需相应平台验证。

## 工作项标签与升级兼容

包含标签能力的本地版本提供 `flowx_list_project_labels`，并在工作项创建、编辑、版本查询工具中接受可选 `labelIds`；标签归属项目，不会改变执行项领取、状态或回传契约。省略更新字段表示保留，`[]` 表示清空。Agent 应先查询目标项目的真实标签 ID，标签实体仍由“项目设置 → 标签”维护，不新增 CLI 管理命令。

服务端与本地包需分别升级；已建立的 IDE MCP 长连接必须重新加载才能发现新工具与参数。旧客户端不传新字段时继续兼容，不会清空已有标签。仅标签路由明确不存在时提示服务端不支持，权限/资源/网络错误继续按原错误处理；已经成功保存却未确认标签的响应会保留工作项 ID 并提示检查，不能直接重复创建。源码构建与 npm 发布是不同步骤，未发布的源码功能不会自动出现在安装用户机器上。

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
Review。所有本地执行都必须通过 `POST /execution-sessions/:id/complete` 回传；工作流级领取、Web、MCP 和 Extension 统一使用 handoff 返回的 `executionSessionId`。

开发 Agent 通过 MCP 使用以下工具：

1. `flowx_report_progress` 追加 `execution.progressed` 进度事件；
2. `flowx_report_evidence` 登记 Git、测试或其他执行证据；
3. `flowx_report_completion` 携带 `executionSessionId` 完成本地执行。

`flowx_report_completion` 要求 `executionSessionId`；应从任务提示、handoff 或本地启动返回值读取该 ID，而不是依赖本地活跃执行文件。

### 运行控制与失联

受控开发会话通过 `flowx_execution_checkpoint` 领取 `CANCEL`、`RESUME`、`REQUEST_SYNC` 命令。命令状态在平台上依次显示为“待领取、已领取待回执、本地已确认或本地处理失败”。平台只能通过协作式回执确认停止，不能远程强杀 IDE 内的 Agent。`STALE` 表示超过 5 分钟没有收到检查点；重新交接前必须确认旧设备上的任务和它启动的命令已经停止。

检查点支持可选 `progressSummary`（非空、最多 2000 字符）。有实质进展时填写“已完成什么、正在做什么”，普通保活省略。服务端在同一事务保存会话摘要和 `execution.progressed` 事件；摘要未变化时不重复登记，终态或待停止回执时不覆盖结果。网页“看板”中的开发进展展示这些实际回报，尚未上报摘要的旧客户端只显示检查点和未知进度。该参数需要新版 `flowx-local` 及重新加载的 MCP/执行技能；进度回报沿用检查点请求，不进入 Outbox，网络失败后先重试检查点再继续。

## 故障排查

### FlowX 提示未检测到 flowx-local

确认安装脚本注册的后台服务在运行（`flowx-local status`），且 `~/.flowx/local.json` 中的 `port` 与页面拿到的 loopback port 一致。
本地服务只监听 `127.0.0.1`，不应暴露到局域网或公网。贡献者或排障可临时执行 `flowx-local serve`。

### 点击 OpenDesign 后只打开 App、没有挂载目录

这是预期行为：项目目录由设计师在 Open Design 内自行选择。FlowX 通过
`~/.flowx/active-design.json` 记录活跃会话，由 Cursor / Codex 中的 `flowx-local mcp` 拉取上下文并回传结果：

1. `flowx_get_active_design_session`
2. `flowx_get_design_handoff`
3. `flowx_submit_design`

也可把可执行文件绝对路径写入 `~/.flowx/local.json` 的 `openDesignCommand`。
不要把 macOS 系统的 `/usr/bin/od` 误认为 OpenDesign CLI。

安装脚本会写入 Skill 与用户级 MCP。旧 Skill 用 `flowx-local update`。intake / 构思细节见用户指南。

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

确认 `idempotencyKey` 非空，并且 `output.design`、
`output.designArtifact.html` 都存在。HTML 必须是完整、自包含文档。

## 安全边界

- 浏览器只把一次性、五分钟有效且仅可兑换一次的 ticket 发到本机 Agent。
- Agent 兑换 ticket 后得到短期 token；FlowX Web 的长期登录态不会落盘到设计目录。
- Outbox 不复制 token，只记录会话凭据引用。
- 本地 HTTP 服务仅绑定 loopback；部署脚本不应改成 `0.0.0.0`。
- 设备级长期凭据与自动刷新尚未实现，属于下一阶段工作。
