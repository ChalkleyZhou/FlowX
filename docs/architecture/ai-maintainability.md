# AI Maintainability Guide

## Why this exists

FlowX is designed to evolve through repeated AI-assisted iterations. That only stays maintainable if the repo tells future agents where the sharp edges are and how to validate changes before handoff.

## High-risk zones

- `apps/api/src/workflow`
- `apps/api/src/common/workflow-state-machine.ts`
- `apps/web/src/api.ts`
- `prisma/schema.prisma`

## Change protocol

1. Clarify which subsystem is changing before editing code.
2. Add or update the nearest automated test first when touching high-risk logic.
3. Make the smallest change that satisfies the requirement.
4. Run the narrow validation command for the touched subsystem.
5. Run `pnpm check` before handoff or merge.

## Validation map

- Workflow and orchestration changes: `pnpm --filter flowx-api test`
- Frontend API boundary changes: `pnpm --filter flowx-web test`
- Cross-cutting verification: `pnpm check`

## Refactor triggers

Refactor before adding features when any of the following becomes true:

- One file carries more than one business responsibility.
- A single change needs simultaneous edits to orchestration logic and persistence details.
- A future agent would need to understand multiple business concepts to safely change one file.

## Expected AI workflow

- Start from the closest existing module instead of creating parallel abstractions.
- Prefer table-driven rules and pure helpers for business invariants.
- Keep diffs narrow and explicit in high-risk files.
- Leave behind tests or docs whenever a new rule is introduced.

## 功能开发与本地工具适配

FlowX 的功能同时服务网页用户和本地 AI 工具。新增功能、修改已有行为或修复缺陷时，必须判断本地消费者能否继续发现能力、获取上下文、执行操作并回传结果。这是每次开发的检查项；是否新增 MCP tool 由具体使用场景决定。

根目录 `AGENTS.md` 是执行规则入口，本节提供评估、实现和验收方法；`CLAUDE.md` 复用同一规范。

### 编码前：明确调用链和适配结论

先查现有实现和使用场景，在当前任务方案中记录适配结论。简单变更可以直接记录在交付说明，不要求额外创建计划文档。

| 检查对象 | 必须回答的问题 | 主要检查位置 |
| --- | --- | --- |
| 业务能力与上下文 | 本地 Agent 是否需要调用？已有工具能否表达新增参数或读取新增信息？ | 对应 API 模块、`packages/flowx-local/src/mcp.ts` |
| 共享契约 | 字段、默认值、枚举、错误码和版本是否影响其他消费者？ | `packages/flowx-protocol/src`、API DTO、`apps/web/src/api.ts` |
| 本地入口 | MCP、CLI、loopback 路由和 Adapter 是否需要同步？参数是否真正透传？ | `packages/flowx-local/src`，相关 IDE 集成 |
| AI 操作说明 | 工具描述和已发布 Skill 是否仍能引导正确的阶段、调用顺序和回传？ | `packages/flowx-local/templates`、工具注册、相关 prompt |
| 升级与兼容 | 已安装的旧版本本地包调用新服务端时会发生什么？ | 受影响 API、协议版本、安装和升级逻辑 |

结论取以下一种：

- **需要适配**：本地流程需要新增能力，或现有调用受影响。在同一变更中同步实现和验证；分期时明确当前未支持的操作、兼容行为与后续工作。
- **复用现有能力**：现有工具已经覆盖，记录工具名称、调用路径和验证依据。已有工具 schema 无法接收或没有透传新参数时，不能判定为已覆盖。
- **不适用**：能力仅涉及页面表现或明确只供网页操作，记录原因，并说明为何不会破坏既有本地流程。不强制把每个 Web 操作都做成 MCP tool。

需求字段、工作流状态、上下文、领取与回传、Artifact/Evidence、权限、执行控制和提测结果变化，都必须检查本地调用链；只修改页面颜色、间距等展示细节通常无需新增工具。

### 实现时：业务共用，入口适配

调用链应复用现有边界：本地 AI → MCP/CLI/Adapter → API → 业务服务和状态机。Web 也通过 API 使用相同业务规则。

- FlowX MCP 统一维护在 `packages/flowx-local/src/mcp.ts`。新增工具前先检查已有工具能否兼容扩展，避免维护多个等价入口。
- MCP、CLI 和 Adapter 负责协议转换、本地文件/进程操作与结果回传；权限、领取身份、状态转换和人工确认由服务端统一校验。
- 本地工具使用受支持的接口获取上下文、上传产物和提交结果。不得靠直连数据库、解析网页 DOM 或人工复制页面内容补齐核心链路。
- 跨端契约在适合的共享位置定义，复用已有类型或运行时 schema；必须在边界做运行时校验，不能仅依赖 TypeScript 类型断言。
- 修改字段时逐项核对：API DTO → 共享契约 → MCP 输入 schema → 请求映射 → 服务端处理 → 返回结果 → 本地/Web 消费者。检查省略、显式 `null`、空字符串和默认值的语义。
- 工具描述应说明用途、前置条件、参数、关键副作用和后续动作；参数与错误结果应让 Agent 能判断重试、补充信息或等待人工处理。
- 写操作延续现有权限、会话归属、幂等和确认规则；重试不能重复创建业务数据，晚到结果不能覆盖新会话。使用 Outbox 的路径要保持凭据隔离和可重试，不为所有工具额外引入队列。

### 发布时：允许服务端与本地包分别升级

- 优先增加可选字段或保留兼容入口，明确字段缺省时的旧行为。更改必填性、删除/改名字段或改变枚举语义都属于需要评估的破坏性变化。
- 新服务端必须验证受影响旧请求的行为；新版工具依赖新服务端能力时，要有可识别的不支持结果或既有版本/能力检查，不能静默忽略请求或误推进状态。
- 必须破坏兼容时，写清支持版本、升级顺序、旧客户端的拒绝或降级行为和迁移方法；协议版本仅在语义变化时按现有版本机制调整。
- 本地包、工具描述和 Skill 模板分别检查。已经安装的 MCP/Skill 不会因服务端上线自动刷新，涉及更新时说明 `flowx-local update` 及必要的 IDE MCP 重新加载步骤。

### 验证时：检查真实边界行为

根据影响范围验证，不以 Web 可用、schema 编译通过或 mock 固定返回成功代替本地适配证据。

| 改动范围 | 必要验证 |
| --- | --- |
| MCP tool 新增或变更 | 工具发现、输入 schema、实际工具调用、请求路径/方法/字段、返回结果和失败映射；可参考 `packages/flowx-local/src/mcp.test.ts` |
| API 与本地契约 | 服务端接受真实工具请求格式，检查必填/可选/空值语义、默认值和旧请求；客户端测试与服务端契约测试配合验证 |
| 权限、会话或状态 | 未登录/无权限、非领取人、错误阶段、过期或取消会话的拒绝路径，以及合法路径 |
| 写入、重试或回传 | 重复调用的幂等行为；涉及 Outbox 时验证失败重传，涉及会话替换时验证旧结果拒绝 |
| CLI、安装或 Adapter | 参数与配置处理、用户已有配置保留，以及受影响的启动/升级路径；无法实测的 IDE/操作系统明确列为未验证 |
| 共享协议 | 协议测试及 API、本地包、Web 等实际受影响消费者的测试和构建 |

常用验证命令：

```bash
pnpm --filter @flowx-ai/local test
pnpm --filter @flowx-ai/local build
pnpm --filter @flowx-ai/protocol test
pnpm --filter @flowx-ai/protocol build
pnpm --filter flowx-api test
pnpm --filter flowx-web test
pnpm check
```

按根目录和各子项目 `AGENTS.md` 选择必要检查，跨包契约变更执行 `pnpm check`。纯文档或规则变更至少执行 `git diff --check`；检查 `docs/user-manual.md`、`docs/local-agent-guide.md` 是否需要更新，修改手册时同步 `apps/web/public` 镜像并执行 `cmp` 校验。

### 交付时：给出可核对的结论

在现有方案、PR 描述或交付说明中包含以下信息，无需另建重复文档：

```text
本地适配：需要适配 / 复用现有能力 / 不适用（保留实际结论）
影响入口：具体工具、CLI、Skill/Adapter、API 或协议；不适用时写明依据
契约与兼容：字段/状态/权限变化，旧客户端行为，是否需要升级与重新加载
验证证据：实际执行的命令、结果，以及未验证的环境或路径
文档同步：README、专题说明、工具描述、Skill、手册及镜像的更新或检查结论
未完成项：没有则写无；分期或受阻时写清限制和后续工作
```

例如，为执行检查点新增可选进度摘要时，应检查 `flowx_execution_checkpoint` 的 schema、请求透传、API 校验及旧版不带摘要的请求，按需要同步执行 Skill 和本地指南；仅在网页新增一个进度展示卡片时，可以复用已有检查点能力，但需确认展示依赖的数据确实已有回传。

## 原型导入边界

原型 ZIP 读取、受限预览和导入状态位于独立 `prototype-imports` 模块；AI 分析以 `prototype-analysis.output.schema.json` 为契约源，消费者共用运行时校验。确认后以工作流 intake 快照作为后续事实来源，避免多个入口重复推导需求与设计。安全外壳、CAS 基线与状态接续的回归属于该模块必需验证，详见 [原型导入](../prototype-import.md)。
