# FlowX 小团队 Agent 研发控制面实施计划

> 文档状态：第一里程碑已实现，第二里程碑待实施
>
> 目标：让 2～10 人的小团队可以稳定使用 Cursor、Codex 等本地 Agent 完成需求和 Bug，FlowX 负责任务、运行、证据、审查和恢复。
>
> 计划原则：先把“本地执行，云端可控、可见、可恢复、可审查”做成闭环，再扩展通用项目管理、多 Agent 编排和企业级基础设施。

## 1. 产品目标

FlowX v1 定位为 **Agent 研发运行控制面**，不是通用项目管理软件，也不是新的 IDE。

云端负责：

- Requirement、Bug、Project 和工作流状态；
- 创建执行会话、交接任务和人工控制；
- 保存进度、Commit 引用、测试结果、Artifact 和 Evidence；
- 推进 AI Review、Human Review 和问题闭环；
- 展示运行中、失联、阻塞、待确认和同步失败的任务。

本地 `flowx-local` 负责：

- 连接本地仓库和用户已安装的 Cursor、Codex 等工具；
- 在本地执行代码修改、测试、构建和调试；
- 采集 Git、测试、日志、截图和 Agent 摘要；
- 在线时立即回传，离线时进入 Outbox，网络恢复后幂等重放。

源码继续以 Git 为事实来源。FlowX 默认保存引用、摘要和证据，不上传完整工作区源码。

## 2. 小团队 MVP 的黄金链路

第一版只验证一条链路：

```text
FlowX 创建 Requirement / Bug
  -> Edge Task / Handoff
  -> 创建 ExecutionSession
  -> flowx-local 绑定本地仓库和执行工具
  -> Agent 本地修改和测试
  -> 回传进度、Commit、测试结果和 Artifact/Evidence
  -> FlowX 校验完成条件
  -> AI Review / Human Review
  -> 完成或生成 Bug 并重新执行
```

首期支持范围：

- 一个组织下的 1～3 个项目；
- 每个项目 1～3 个 Repository；
- `Requirement` 和 `Bug` 作为任务来源；
- Cursor、Codex 和 `flowx-local MCP`；
- 本地执行、远程分支校验、测试摘要和结构化完成报告；
- 一台设备一个活动执行会话。

首期不要求：多 Agent 自动排班、复杂任务图、云端执行、自动部署和完整发布中心。

## 3. 当前代码基线和缺口

当前已经具备：

- `ExecutionSession`、`SyncEvent`、`Artifact`、`Evidence` 数据模型；
- Edge Task、Context Package 和 Handoff API；
- `flowx-local` 的设备配置、Adapter 和 Outbox 基础能力；
- Cursor、Codex、OpenDesign 的本地接入基础；
- 执行会话心跳、协作式取消/恢复/同步命令、检查点、失联计算、完成幂等和组织边界校验；
- 工作流详情中的执行会话和证据展示基础。

本计划不重新建设上述底座，重点补齐以下断点：

1. 开发执行的进度、证据和完成报告还没有全部统一走 `flowx-local` Outbox；当前可靠离线回传主要覆盖设计/头脑风暴链路。
2. Web 可以请求取消，但本地 Agent 缺少稳定的控制命令拉取和确认机制。
3. 会话失联、同步失败和待恢复状态缺少统一的项目级视图。
4. 完成校验还需要固化为“Commit、测试、摘要、必要证据”的可配置门禁。
5. 断网、响应丢失、进程崩溃、重复完成和 Artifact 登记失败的黄金链路测试仍需补齐。

## 4. 核心运行模型

### 4.1 执行会话状态

```text
CREATED
  -> CLAIMED
  -> RUNNING
  -> BLOCKED -> RUNNING
  -> COMPLETING
  -> COMPLETED | FAILED | CANCELLED
```

失联不单独复制一套状态。服务端根据 `lastHeartbeatAt` 和执行策略计算 `STALE`，显示在控制面中，并提供重新认领或取消入口。

约束：

- 同一个 `StageExecution` 默认只能有一个活动主会话；
- 终态会话不能继续接收普通进度事件；
- 完成、失败、取消和 Artifact 登记都必须支持幂等；
- 所有事件带 `eventId`、`idempotencyKey`、`traceId` 和协议版本；
- 会话状态由云端 API 负责，本地只保存运行绑定和待同步数据。

### 4.2 最小控制命令

第一版新增轻量 `ExecutionCommand`，只支持运行控制所需的动作：

```text
CANCEL
RESUME
REQUEST_SYNC
```

重试创建新的 `ExecutionSession`，不复用已经进入终态的会话。

建议字段：

```text
ExecutionCommand
- id
- executionSessionId
- commandType
- status: CREATED | DELIVERED | ACKED | FAILED | EXPIRED
- idempotencyKey
- requestedByUserId?
- payload?
- issuedAt
- deliveredAt?
- acknowledgedAt?
- errorMessage?
- createdAt
- updatedAt
```

本地 Agent 通过心跳响应或短轮询获取命令，执行后回传确认。首期不做 WebSocket 和通用消息队列。

### 4.3 本地回传数据

每个本地执行至少应能回传：

- 执行进度和当前阶段；
- 阻塞原因和人工介入请求；
- Repository、branch、head SHA；
- changed files 和变更摘要；
- 测试命令、测试结果和失败摘要；
- Agent implementation summary；
- 可选的日志、截图、HTML、coverage 和测试报告 Artifact。

API 离线时，用户界面必须明确显示“等待同步”，不能把本地完成误显示为平台已完成。

## 当前交付边界

第一里程碑已覆盖运行控制面、`ExecutionCommand`、本地检查点与回执、Agent 运行列表、工作流详情控制入口、受控完成绑定、基线 Git 报告和真实临时 SQLite 事务测试。当前仍未完成开发执行全量 Outbox 接入、自动同步 worker、完成门禁配置化和项目驾驶舱；这些属于后续里程碑。

## 5. 五周实施计划

### 第 1 周：运行控制面 v1

目标：FlowX 能准确回答“哪个 Agent 在执行什么、是否还活着、谁可以控制它”。

任务：

- 固化 `ExecutionSession` 状态转换和失联判定；
- 增加 `ExecutionCommand` 及幂等确认；
- 补充 `GET /execution-sessions` 的项目、状态、工具和时间筛选；
- 增加取消、恢复和重新认领接口；
- 心跳限频，避免 SQLite 被高频写入；
- 在工作流详情展示会话状态、工具、设备、最后心跳、Trace 和控制动作。

验收：

- Web 取消后本地 Agent 能收到命令并确认；
- Agent 失联后可以被发现和重新认领；
- 重复取消、重复确认不会生成重复状态变化；
- 跨组织用户不能读取或控制其他组织的会话。

### 第 2 周：统一本地 Edge Client 和 Outbox

目标：开发执行也具备设计执行已有的可靠回传能力。

任务：

- 把 MCP 的 progress、evidence、completion 请求统一交给 `EdgeClient`；
- 扩展 `OutboxItem` 支持进度、事件、Artifact 上传和完成报告；
- Outbox 保存稳定文件副本、重试次数、下次重试时间和最后错误；
- 短期 Token 只在发送时解析，不写入 Outbox payload；
- 增加 `flowx-local sync`、`flowx-local status` 的开发执行状态摘要；
- 统一 `executionSessionId`、`workflowRunId` 和本地仓库绑定。

验收：

- API 离线时，进度和完成报告进入 Outbox；
- 重启 `flowx-local` 后待同步数据不丢失；
- 网络恢复后按稳定幂等键重放；
- 同一完成报告重放多次不会重复完成工作流或创建 Artifact。

### 第 3 周：完成门禁和证据闭环

目标：平台只在证据满足要求时接受本地完成。

任务：

- 统一 Git、测试、摘要和用户确认的 Evidence 类型；
- 完成接口验证远程 branch、head SHA 和工作流仓库范围；
- 把测试结果、changed files 和 Agent 摘要登记为 Artifact/Evidence；
- Artifact 上传采用 `PENDING -> AVAILABLE -> FAILED` 生命周期；
- 登记失败时保留本地可恢复状态，不回滚已经有效的执行结果；
- Review 页面能从 Finding 定位到执行会话、Commit 和测试证据。

验收：

- 每个成功完成的本地执行都有 Commit 或明确的无代码变更说明；
- 每个完成报告都有测试结果或人工跳过理由；
- 重复上传同一内容不会产生重复证据；
- Artifact 文件写入成功但数据库响应丢失时可以安全恢复。

### 第 4 周：小团队工作台

目标：负责人无需打开多个工作流详情，就能处理团队的 Agent 状态。

新增两个聚合视图：

- **Agent 收件箱**：可领取、运行中、阻塞、失联、待同步、待确认的任务；
- **项目驾驶舱**：活跃会话、最近完成、Review 队列、失败同步、缺少证据和高优先级 Bug。

同时增加：

- 待人工确认和待重新交接列表；
- 同步失败的显式重试入口；
- 项目级执行耗时、完成率和阻塞原因统计；
- 钉钉或现有投递目标的关键异常通知。

验收：

- 团队负责人可以在一个页面找到所有需要处理的事项；
- 用户能区分“Agent 本地已完成”和“FlowX 已接收完成”；
- 不支持新字段的旧 API 响应仍能正常渲染。

### 第 5 周：真实试点和故障演练

目标：用真实团队连续使用两周前，先在测试环境证明不会丢状态。

必须覆盖：

- API 离线后回传进入 Outbox；
- 网络恢复后事件顺序和幂等重放；
- 完成请求发出但响应丢失；
- Agent 进程在 Artifact 上传中途退出；
- 数据库登记成功但客户端没有收到响应；
- 用户取消后旧 Agent 继续提交完成；
- Token 过期、仓库 branch 变化、远程验证失败；
- Bug 修复从领取到回归测试的完整链路。

真实试点条件：

- 3 个小团队或 1 个内部团队；
- 每个团队至少完成 10 个 Requirement/Bug；
- 至少使用 Cursor 和 Codex 各一次；
- 连续使用 2 周，不允许通过手工改数据库修复任务。

## 6. MVP 验收指标

以下指标用于判断是否进入下一阶段，而不是追求一次性达到企业级规模：

- 新用户从安装到完成首个本地任务不超过 30 分钟；
- 从 Web 交接到 Agent 获得上下文不超过 2 分钟；
- 已完成任务的 Commit、测试结果和摘要证据覆盖率达到 95% 以上；
- 重复提交不产生重复完成、重复 Artifact 或重复 Bug；
- 断网恢复不造成已确认完成任务丢失；
- 运行中、失联、阻塞和待确认任务可以在一个页面找到；
- 试点团队每周持续使用，而不是只完成一次演示；
- 至少一个团队愿意为团队协作、审计和历史证据付费试用。

## 7. 暂缓事项和升级条件

首期暂缓：

- 通用 `WorkItem / Task DAG` 和复杂依赖调度；
- 多 Agent 自动排班、资源优化和抢占；
- PostgreSQL、Redis/BullMQ、多实例 Worker；
- MinIO/S3 大文件服务；
- CI/CD 发布、环境、灰度和运行反馈中心；
- Agent/Skill 市场和泛化项目管理能力。

只有在以下情况出现后再扩展：

- 一个 Requirement 经常需要多个 Agent 并行；
- 单实例 SQLite 已出现明显并发瓶颈；
- 团队需要跨设备和跨项目自动调度；
- 试点用户开始要求发布门禁和运行反馈；
- 用户愿意为执行历史、质量证据和治理能力持续付费。

## 8. 实施顺序和提交拆分

建议拆成五个可独立审查的变更：

1. `feat(api): 完善执行会话控制和执行命令`
2. `feat(local): 将开发执行回传接入 Edge Client 和 Outbox`
3. `feat(api): 固化本地完成门禁和证据登记`
4. `feat(web): 增加 Agent 收件箱和项目驾驶舱`
5. `test(edge): 覆盖断网、重试、取消和响应丢失黄金链路`

每个变更都要先补边界测试，再修改高风险的工作流、协议、Prisma 和 API 代码。交付前运行受影响 package 的测试，并在跨 API、Web、Local 和 Protocol 后运行 `pnpm check`。

