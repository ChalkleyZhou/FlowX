# OpenDesign 长期 API Token 与构思→设计无缝衔接

**Date:** 2026-07-24
**Status:** Approved for planning
**Depends on:** [OpenDesign design stage](../../opendesign-design-stage.md), [Workflow OpenDesign brainstorm](./2026-07-22-workflow-opendesign-brainstorm-design.md), [OpenDesign MCP context pull](./2026-07-22-opendesign-mcp-context-pull-design.md), [Web local IDE launch](./2026-07-16-web-local-ide-launch-design.md)
**Approach:** 双轨兼容 — Personal API Token 为主路径；Web 一键启动 + 短期 `active-design` 为可选兜底

## Goal

用户在 OpenDesign 完成产品构思并提交后，**同一本地会话即可直接进入设计阶段**，不必回 FlowX Web 再点一次「打开本地 OpenDesign」。

本地主鉴权改为**用户级长期 Personal API Token**（与登录用户同权、默认不过期），通过 `flowx-local login` 或 Web 设置写入本机；任务经 MCP list → 用户确认 → 本机 binding 发现。服务端仍用 `ExecutionSession` 记账与回传，不推倒 Evidence / 幂等模型。

## Problem

当前链路刻意拆成两次本地启动：

1. `BRAINSTORM_PENDING` → Web「打开本地构思」→ 短期 token 写入 `active-design.json` → submit → `DESIGN_PENDING`
2. `DESIGN_PENDING` → 必须再点「打开本地 OpenDesign」→ 新的 design `ExecutionSession` + 新短期 token

痛点：

- 构思完成后无法在同一 OpenDesign 会话继续设计。
- 短期 session 凭据与 Web 点击强绑定，不如长期用户 `API_TOKEN` 稳定、可预期。

## Decisions

| 主题 | 选择 |
| --- | --- |
| 总体方案 | 双轨兼容（方案 1）：长期 token 主路径 + 旧短期 session 兼容 |
| ExecutionSession | **保留**服务端实体；设计阶段在 **design handoff** 时惰性创建（submit 兜底补建） |
| 本地活跃短期 session | 降为可选；不再是进入设计的硬门槛 |
| Token 类型 | 用户级 Personal API Token，绑定 `userId` + 组织上下文 |
| Token 过期 | **默认不过期**；支持撤销与本机登出清除 |
| Token 权限 | **与浏览器登录用户同权**；v1 不做细粒度 `scopes` |
| Token 发放 | Web 设置页生成/轮换/撤销 **+** `flowx-local login` 写入本机 |
| 任务发现 | MCP list 可构思/可设计任务 → Agent 与用户确认 → 本机 binding 短缓存 |
| 构思→设计 | submit brainstorm 响应带 `next`；本地更新 binding.stage；立刻可 `get_design_handoff` |
| 设计确认门 | 不变：`submit_design` → `DESIGN_WAITING_CONFIRMATION` |
| 开发阶段 Cursor/Codex launch | 本次不强制改用 Personal Token（可后续复用） |

## Non-goals

- 细粒度 token scope / 自动 TTL 续期
- 删除 `ExecutionSession` 或改掉 design complete 契约
- 去掉 Web「打开本地 OpenDesign / 构思」入口
- 合并 brainstorm + design 为单次 submit
- 修改 OpenDesign 产品本身
- 本次把开发阶段 launch 全部切到 Personal Token

## Target user flow

```text
flowx-local login  或  Web 生成 token → 写入 ~/.flowx/credentials.json / FLOWX_API_TOKEN
        │
        ▼
OpenDesign + flowx-local mcp
  flowx_list_tasks → 用户确认 workflowRunId → 写入 current binding
        │
        ▼
flowx_get_brainstorm_handoff → 澄清 → spec.md → flowx_submit_brainstorm
        │
        ▼  响应: DESIGN_PENDING + next.stage=design；binding 切到 design
        │
        ▼
同一会话: flowx_get_design_handoff（惰性创建 design ExecutionSession）
        → 设计 → flowx_submit_design
        │
        ▼
Web: DESIGN_WAITING_CONFIRMATION
```

验收：全程**无需**第二次点击「打开本地 OpenDesign」。

## Architecture

### Responsibility split

| 对象 | 职责 |
| --- | --- |
| Personal API Token | 本机长期鉴权；与 Session Bearer 同权校验 |
| `~/.flowx/credentials.json` | 存长期 token（`0600`）；不进项目目录 / Outbox |
| `~/.flowx/current-workflow.json` | 本机当前 `workflowRunId` + stage 提示缓存；**不含** token |
| `ExecutionSession` | 一次构思或设计本地执行的服务端生命周期、Evidence、幂等 complete |
| `active-design.json` | 兼容旧路径的短期凭据；非主路径必需 |
| Web ticket launch | 可选：写调试目录、帮助绑定、兼容未 login 用户 |

### Auth resolution (MCP)

1. `process.env.FLOWX_API_TOKEN`
2. `~/.flowx/credentials.json`（login / 手动写入）
3. 活跃 `active-design` 短期 `accessToken`（兼容）

无凭据时明确提示 login / 配置 token /（可选）Web 启动。

### Binding resolution (MCP)

工具参数中的 `workflowRunId` / `executionSessionId` 优先 → 否则 `current-workflow.json` → 再否则报错并提示 list/绑定。

Binding 不是权限源；API 始终按 token 对应用户做授权。

## 1. Auth and token lifecycle

### Data model (sketch)

- `PersonalApiToken`（名称可调整）：`id`, `userId`, `organizationId`（或与现有 org 成员关系对齐）, `name`, `tokenHash`, `tokenPrefix`（便于列表辨认）, `createdAt`, `lastUsedAt`, `revokedAt`
- 明文只在创建响应或 login 完成时返回一次；之后不可再读出
- 默认 `expiresAt = null`（不过期）

### Web

- 用户设置：生成、复制一次明文、列表（元数据）、撤销、轮换（撤销旧 + 发新）
- 不把长期 token 经浏览器发给 loopback；Web→local 仍可用一次性 ticket（可选路径）

### CLI

- `flowx-local login`：浏览器或设备码 → 兑换后写入 `~/.flowx/credentials.json`
- `flowx-local logout`：清除本机凭据（不强制撤销服务端 token，可提示）
- 亦支持把 Web 复制的 token 写入同一文件或 env

### Security

- Token 不进 Outbox payload、结构化日志、git、项目目录
- 已撤销 token：401/403；**不**静默回退到其他用户的短期 session

## 2. Task discovery and local binding

### List

增强 `flowx_list_tasks`（或等价 API），至少返回当前用户可访问且可本地处理的项：

- `workflowRunId`
- 需求标题等展示字段
- `status` / 建议动作：`brainstorm`（如 `BRAINSTORM_PENDING`）或 `design`（如 `DESIGN_PENDING`）

### Bind

- Agent 展示候选 → 用户确认一条
- 写入 `~/.flowx/current-workflow.json`：`workflowRunId`, `stage`, `boundAt`, 可选展示字段
- 可选 MCP 工具 `flowx_bind_workflow`；若 v1 不加工具，也可在 handoff 成功时自动写入 binding
- Web 一键启动可顺便刷新 binding

### `flowx_get_active_design_session`

保留。无 `active-design` 时，可返回 binding + credentials 是否存在的状态，并标明「非短期 session」，避免 Agent 误判必须先 Web 启动。

## 3. Seamless brainstorm → design and ExecutionSession

### Stage semantics (unchanged)

- Brainstorm complete → `DESIGN_PENDING`
- Design complete → `DESIGN_WAITING_CONFIRMATION`

### Sessions

- Brainstorm：沿用现有创建/完成逻辑
- Design：在长期 token 下，于 `GET .../design/local-handoff` **惰性创建**（或复用进行中的）design `ExecutionSession`（同一 `workflowRunId`），并在 handoff 响应中返回 `executionSessionId`
- 若未先拉 handoff 直接 `submit_design`：允许按 binding/`workflowRunId` 补建 session 后完成（兜底），推荐路径仍是先 handoff
- Complete 仍走 `/execution-sessions/:id/brainstorm|design/complete`
- 重复 handoff：复用或刷新进行中的 design session；不覆盖已有本地 `result.json` 编辑（与现行为对齐）

### Submit brainstorm response extension

成功响应增加（旧客户端忽略未知字段）：

```json
{
  "workflowRunId": "...",
  "workflowStatus": "DESIGN_PENDING",
  "next": {
    "stage": "design",
    "hint": "call flowx_get_design_handoff"
  },
  "executionSessionId": "optional-if-already-created"
}
```

本地收到成功后：更新 binding `stage: design`；**不要求**刷新短期 `active-design` token。

### Failure boundary

- 构思已成功但随后 design handoff 失败：不回滚构思；提示重试 handoff
- Run 不在可设计状态（回滚到构思、已在等待确认等）：handoff 返回明确 status 与允许动作

## 4. API / MCP surface and compatibility

### New or extended API

- Personal API Token CRUD（用户设置）
- Login 兑换端点（供 `flowx-local login`）
- 任务列表增强（可本地构思/设计）
- Design `local-handoff`：支持 Personal Token；必要时惰性创建 design session
- Brainstorm complete 响应扩展 `next`

### MCP (`flowx-local mcp`，兼容 `flowx-mcp`)

- 鉴权顺序与 binding 解析见上
- `flowx_list_tasks` 增强；可选 `flowx_bind_workflow`
- `get_*_handoff` / `submit_*`：可省略 id（用 binding）
- `submit_brainstorm` 成功后提示/自动将 binding 切到 design

### Compatibility (must keep green)

- Web → ticket → redeem → 短期 token → `active-design.json`
- `/execution-sessions/:id/.../complete` 契约
- 仅短期 active-design、无 Personal Token 的旧金路径

### Docs to update (same change)

- `docs/opendesign-design-stage.md`
- `docs/local-agent-guide.md`
- `docs/user-manual.md` + `apps/web/public` 镜像
- 推荐路径改为：login/token → list → 构思 → 直接设计；Web 打开降为可选

## 5. Errors and testing

### Errors (Agent-readable)

| 情况 | 行为 |
| --- | --- |
| 无凭据 | 提示 login / `FLOWX_API_TOKEN` / Web 生成 token |
| 无 binding 且未传 id | 提示 `flowx_list_tasks` 并确认绑定 |
| Token 撤销 / 无权限 | 401/403，不静默顶替其他凭据 |
| 阶段不匹配 | 返回当前 status 与允许动作 |
| 构思成功、设计 handoff 失败 | 保留构思结果；可重试 handoff |

### Tests (priority)

- Auth：创建、hash 存储、撤销、同权 Bearer；与 Session 共存
- Handoff：长期 token 下惰性创建 design session；重复拉取安全
- MCP：无 active-design 时凭 credentials + binding 跑通 brainstorm→design
- 兼容：仅短期 active-design 旧路径仍绿
- 安全：token 不出现在 Outbox、日志、项目目录

### Acceptance golden path

1. `login` 或配置长期 token
2. list → 确认绑定构思中的 run
3. brainstorm handoff → `spec.md` → submit
4. **同一 OpenDesign 会话**立刻 design handoff → 设计 → submit
5. Web 进入设计待确认；**未**第二次点击「打开本地 OpenDesign」

## Out of scope follow-ups

- Personal Token 复用到 Cursor/Codex 开发阶段 launch
- Token scopes / 可选 TTL
- 去掉短期 active-design 协议（待 Personal Token 成为默认且稳定后评估）

## Open points (resolved in plan)

- Prisma：`PersonalApiToken` 绑定 `userId` + `organizationId`（见实现计划）
- Login v1：`flowx-local login [--token]` 粘贴/传入 Web 生成的 PAT（设备码后续）
- 独立 MCP 工具 `flowx_bind_workflow`；handoff/submit 成功亦可刷新 binding
- Design/brainstorm session 惰性创建挂在 local-handoff
